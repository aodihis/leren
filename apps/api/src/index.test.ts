import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
  queue: { close: vi.fn() },
  createRabbitMqQueue: vi.fn(),
  rateLimiter: { close: vi.fn() },
  observer: { close: vi.fn() },
  emailSender: { verify: vi.fn() },
  server: { close: vi.fn() },
  serve: vi.fn(),
  createApp: vi.fn(),
  createAgent: vi.fn(),
  loadHarness: vi.fn(),
  resolveEmbeddingModel: vi.fn(),
  recordInboundEmail: vi.fn(),
  parseEncryptionKey: vi.fn(),
}));

vi.mock("./config", () => ({ loadConfig: () => mocks.config }));

vi.mock("./app", () => ({ createApp: mocks.createApp }));

vi.mock("./modules/assistant/agent", () => ({ createAgent: mocks.createAgent }));

vi.mock("./modules/auth/service", () => ({ createAuth: () => ({}) }));

vi.mock("./modules/playbooks/indexing", () => ({ createKnowledgeIndexRequester: () => vi.fn() }));

vi.mock("../../../harness.config", () => ({ default: {} }));

vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));

vi.mock("@leren/agents", () => ({
  loadHarness: mocks.loadHarness,
  resolveEmbeddingModel: mocks.resolveEmbeddingModel,
}));

vi.mock("@leren/channels", () => ({
  createChannelProviders: () => new Map(),
  parseEncryptionKey: mocks.parseEncryptionKey,
}));

vi.mock("@leren/connectors", () => ({ createConnectors: () => new Map() }));

vi.mock("@leren/db", () => ({ createDb: () => ({}) }));

vi.mock("@leren/email", () => ({ createSmtpEmailSender: () => mocks.emailSender }));

vi.mock("@leren/embedder", () => ({ createEmbedder: () => ({ embedder: true }) }));

vi.mock("@leren/inbox", () => ({ recordInboundEmail: mocks.recordInboundEmail }));

vi.mock("@leren/logger", () => ({ createLogger: () => mocks.logger }));

vi.mock("@leren/observability", () => ({ createObserver: () => mocks.observer }));

vi.mock("@leren/queue", () => ({ createRabbitMqQueue: mocks.createRabbitMqQueue }));

vi.mock("@leren/rate-limit", () => ({ createRedisRateLimiter: () => mocks.rateLimiter }));

vi.mock("@leren/vector-db", () => ({ createVectorStore: () => ({ store: true }) }));

const baseConfig = {
  PORT: 3000,
  DATABASE_URL: "postgres://db",
  RABBITMQ_URL: "amqp://queue",
  REDIS_URL: "redis://cache",
  SMTP_URL: "smtp://mail",
  EMAIL_FROM: "Leren <no-reply@leren.test>",
  BETTER_AUTH_SECRET: "auth-secret",
  API_URL: "http://api.test",
  PLATFORM_URL: "http://app.test",
  MCP_SESSION_SECRET: "mcp-secret",
  VECTOR_STORE_URL: "http://qdrant",
  VECTOR_STORE_API_KEY: "",
  CHANNEL_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  CHANNEL_PROVIDERS: ["google"],
};

const handlers = new Map<string, () => Promise<void>>();

/** Starts the API process with `config`, as running the entry point does. */
async function start(config: Record<string, unknown> = {}) {
  mocks.config = { ...baseConfig, ...config };
  vi.resetModules();
  await import("./index");
}

/** The options that the app was built with. */
function appOptions() {
  return mocks.createApp.mock.calls[0]?.[0];
}

describe("API entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mocks.createRabbitMqQueue.mockResolvedValue(mocks.queue);
    mocks.emailSender.verify.mockResolvedValue(undefined);
    mocks.serve.mockReturnValue(mocks.server);
    mocks.server.close.mockImplementation((callback: () => void) => callback());
    mocks.createApp.mockReturnValue({ fetch: vi.fn() });
    mocks.createAgent.mockReturnValue("assistant");
    mocks.parseEncryptionKey.mockReturnValue(Buffer.alloc(32));
    mocks.loadHarness.mockResolvedValue({
      readPrompt: async () => "You are the assistant.",
      createModel: () => ({}),
    });
    mocks.resolveEmbeddingModel.mockReturnValue({
      apiKey: "key",
      definition: { baseUrl: "https://embed.test", modelId: "embed", dimensions: 8 },
    });
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler);

      return process;
    }) as typeof process.on);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the app with the assistant and knowledge search, and listens on its port", async () => {
    await start();

    expect(appOptions()).toMatchObject({
      assistant: "assistant",
      inbox: { simulate: false },
      mcp: {
        secret: "mcp-secret",
        search: { store: { store: true }, embedder: { embedder: true } },
      },
      channelAccounts: { encryptionKey: Buffer.alloc(32), platformUrl: "http://app.test" },
    });
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ mcpUrl: "http://127.0.0.1:3000/mcp" }),
    );
    expect(mocks.serve).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
      expect.any(Function),
    );

    mocks.serve.mock.calls[0]?.[1]({ port: 3000 });

    expect(mocks.logger.info).toHaveBeenCalledWith("API listening", { port: 3000 });
  });

  it("records simulated inbound mail when the development mail provider is on", async () => {
    await start({ CHANNEL_PROVIDERS: ["mailpit"], CHANNEL_TOKEN_ENCRYPTION_KEY: undefined });

    await appOptions().inbox.recordEmail({ subject: "Hi" });

    expect(appOptions().inbox.simulate).toBe(true);
    expect(appOptions().channelAccounts.encryptionKey).toBeUndefined();
    expect(mocks.recordInboundEmail).toHaveBeenCalledWith(
      { db: {}, queue: mocks.queue },
      { subject: "Hi" },
    );
  });

  it("serves every other route when the assistant and knowledge search cannot be built", async () => {
    mocks.loadHarness.mockRejectedValue(new Error("no prompt"));
    mocks.resolveEmbeddingModel.mockImplementation(() => {
      throw new Error("no embedding key");
    });

    await start();

    expect(appOptions().assistant).toBeUndefined();
    expect(appOptions().mcp.search).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith("The assistant chat is disabled", {
      error: expect.any(Error),
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith("Knowledge search is disabled for MCP", {
      error: expect.any(Error),
    });
  });

  it("logs an SMTP server that cannot be reached", async () => {
    mocks.emailSender.verify.mockRejectedValue(new Error("refused"));

    await start();

    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "Cannot reach the SMTP server, so sign-in codes will not be delivered",
        { error: expect.any(Error) },
      ),
    );
  });

  it("closes the server, the telemetry, the queue and Redis once on a signal", async () => {
    await start();

    await Promise.all([handlers.get("SIGTERM")?.(), handlers.get("SIGINT")?.()]);

    expect(mocks.server.close).toHaveBeenCalledOnce();
    expect(mocks.observer.close).toHaveBeenCalledOnce();
    expect(mocks.queue.close).toHaveBeenCalledOnce();
    expect(mocks.rateLimiter.close).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("exits with a failure when it cannot shut down cleanly", async () => {
    mocks.queue.close.mockRejectedValue(new Error("stuck"));

    await start();
    await handlers.get("SIGTERM")?.();

    expect(mocks.logger.error).toHaveBeenCalledWith("The API did not shut down cleanly", {
      error: expect.any(Error),
    });
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("exits when the RabbitMQ connection is lost", async () => {
    await start();

    mocks.createRabbitMqQueue.mock.calls[0]?.[0].onConnectionLost(new Error("closed"));

    expect(mocks.logger.fatal).toHaveBeenCalledWith("Lost the RabbitMQ connection", {
      error: expect.any(Error),
    });
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
