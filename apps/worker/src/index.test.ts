import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  queue: { publish: vi.fn(), close: vi.fn() },
  createRabbitMqQueue: vi.fn(),
  worker: { start: vi.fn(), stop: vi.fn() },
  observer: { close: vi.fn() },
  createJobs: vi.fn(),
  requestEmailPolls: vi.fn(),
  loadHarness: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

vi.mock("./config", () => ({ loadConfig: () => mocks.config }));

vi.mock("./logger", () => ({ logger: mocks.logger }));

vi.mock("./modules", () => ({ createJobs: mocks.createJobs }));

vi.mock("./modules/email-poll/job", () => ({ requestEmailPolls: mocks.requestEmailPolls }));

vi.mock("./modules/knowledge-index/job", () => ({ KNOWLEDGE_DRIFT_QUEUE: "knowledge.drift" }));

vi.mock("./modules/reply-run/pipeline", () => ({ createPipelineRunner: () => vi.fn() }));

vi.mock("./worker", () => ({
  Worker: class {
    start = mocks.worker.start;
    stop = mocks.worker.stop;
  },
}));

vi.mock("../../../harness.config", () => ({ default: {} }));

vi.mock("@leren/agents", () => ({
  loadHarness: mocks.loadHarness,
  resolveEmbeddingModel: () => ({
    apiKey: "key",
    definition: { baseUrl: "https://embed.test", modelId: "embed", dimensions: 8 },
  }),
}));

vi.mock("@leren/channels", () => ({
  createChannelProviders: () => ({}),
  parseEncryptionKey: () => Buffer.alloc(32),
}));

vi.mock("@leren/db", () => ({ createDb: () => ({}) }));

vi.mock("@leren/inbox", () => ({ EMAIL_DELIVER_QUEUE: "email.deliver" }));

vi.mock("@leren/embedder", () => ({ createEmbedder: () => ({}) }));

vi.mock("@leren/observability", () => ({ createObserver: () => mocks.observer }));

vi.mock("@leren/queue", () => ({ createRabbitMqQueue: mocks.createRabbitMqQueue }));

vi.mock("@leren/reply-agent", () => ({ readReplyPrompts: async () => ({}) }));

vi.mock("@leren/vector-db", () => ({ createVectorStore: () => ({}) }));

const baseConfig = {
  DATABASE_URL: "postgres://db",
  RABBITMQ_URL: "amqp://queue",
  MCP_URL: "http://api.test/mcp",
  KNOWLEDGE_DRIFT_INTERVAL_MINUTES: 10,
  EMAIL_POLL_INTERVAL_SECONDS: 60,
  CHANNEL_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
};

const handlers = new Map<string, () => Promise<void>>();

/** Starts the worker process with `config`, as running the entry point does. */
async function start(config: Record<string, unknown>) {
  mocks.config = { ...baseConfig, ...config };
  vi.resetModules();
  await import("./index");
}

/** The options that the jobs were built with. */
function jobOptions() {
  return mocks.createJobs.mock.calls[0]?.[0];
}

describe("worker entry point", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    mocks.createRabbitMqQueue.mockResolvedValue(mocks.queue);
    mocks.queue.publish.mockResolvedValue(undefined);
    mocks.requestEmailPolls.mockResolvedValue(undefined);
    mocks.createJobs.mockReturnValue([{ name: "email.process" }]);
    mocks.loadHarness.mockResolvedValue({ createModel: vi.fn() });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler);

      return process;
    }) as typeof process.on);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts the jobs of its roles and requests the mailbox polls at start and on each interval", async () => {
    await start({ WORKER_ROLES: ["listener", "processor"], MCP_SESSION_SECRET: "secret" });

    expect(jobOptions()).toMatchObject({
      listener: { pollIntervalMs: 60_000 },
      processor: { reply: expect.objectContaining({ runPipeline: expect.any(Function) }) },
      indexer: undefined,
    });
    expect(mocks.worker.start).toHaveBeenCalledOnce();
    expect(mocks.requestEmailPolls).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.requestEmailPolls).toHaveBeenCalledTimes(2);
  });

  it("logs a mailbox poll request that fails and keeps running", async () => {
    mocks.requestEmailPolls.mockRejectedValue(new Error("db down"));

    await start({ WORKER_ROLES: ["listener"] });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith("Could not request the email polls", {
        error: expect.any(Error),
      }),
    );
  });

  it("publishes the deliveries of a reply with the message id as the idempotency key", async () => {
    await start({ WORKER_ROLES: ["processor"], MCP_SESSION_SECRET: "secret" });

    await jobOptions().processor.reply.publishDeliver({ messageId: "m1" });

    expect(mocks.queue.publish).toHaveBeenCalledWith(
      "email.deliver",
      { messageId: "m1" },
      { idempotencyKey: "m1" },
    );
  });

  it("stops at startup when a processor-only process cannot build the reply pipeline", async () => {
    await expect(start({ WORKER_ROLES: ["processor"] })).rejects.toThrow("MCP_SESSION_SECRET");
    expect(mocks.worker.start).not.toHaveBeenCalled();
  });

  it("runs the other roles without the reply pipeline when it cannot be built", async () => {
    await start({ WORKER_ROLES: ["listener", "processor"] });

    expect(mocks.logger.warn).toHaveBeenCalledWith("The reply pipeline is disabled", {
      error: expect.any(Error),
    });
    expect(jobOptions().processor.reply).toBeUndefined();
    expect(mocks.worker.start).toHaveBeenCalledOnce();
  });

  it("requests a knowledge drift check at start and on each interval, and logs a failure", async () => {
    mocks.queue.publish.mockRejectedValueOnce(new Error("queue down"));

    await start({ WORKER_ROLES: ["indexer"], VECTOR_STORE_URL: "http://qdrant" });

    expect(jobOptions()).toMatchObject({
      listener: undefined,
      processor: undefined,
      indexer: { store: {}, embedder: {} },
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith("Could not request a knowledge drift check", {
        error: expect.any(Error),
      }),
    );

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(mocks.queue.publish).toHaveBeenCalledTimes(2);
    expect(mocks.queue.publish).toHaveBeenLastCalledWith("knowledge.drift", {});
  });

  it("refuses to start the indexer role without a vector store", async () => {
    await expect(start({ WORKER_ROLES: ["indexer"] })).rejects.toThrow("VECTOR_STORE_URL");
  });

  it.each(["SIGINT", "SIGTERM"])(
    "stops its timers, the worker, the queue and the observer on %s",
    async (signal) => {
      await start({ WORKER_ROLES: ["listener"] });
      await handlers.get(signal)?.();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(mocks.requestEmailPolls).toHaveBeenCalledOnce();
      expect(mocks.worker.stop).toHaveBeenCalledOnce();
      expect(mocks.queue.close).toHaveBeenCalledOnce();
      expect(mocks.observer.close).toHaveBeenCalledOnce();
      expect(process.exit).toHaveBeenCalledWith(0);
    },
  );

  it("exits when the RabbitMQ connection is lost", async () => {
    await start({ WORKER_ROLES: ["listener"] });

    mocks.createRabbitMqQueue.mock.calls[0]?.[0].onConnectionLost(new Error("closed"));

    expect(mocks.logger.fatal).toHaveBeenCalledWith("Lost the RabbitMQ connection", {
      error: expect.any(Error),
    });
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
