import type { Db } from "@leren/db";
import { describe, expect, it } from "vitest";

import { createJobs } from "./index";
import type { JobDependencies } from "./index";

const base: Pick<JobDependencies, "db" | "queue"> = {
  db: {} as Db,
  queue: { publish: async () => ({}) as never },
};

const listener = {
  channels: { providers: new Map(), encryptionKey: undefined },
  pollIntervalMs: 1,
};

const deliver = { channels: { providers: new Map(), encryptionKey: undefined } };

const indexer = { store: {} as never, embedder: {} as never };

const reply = {
  db: {} as Db,
  observer: { flush: async () => {} },
  sessions: {} as never,
  runPipeline: async () => ({}) as never,
  publishDeliver: async () => {},
};

const names = (dependencies: Omit<JobDependencies, "db" | "queue">) =>
  createJobs({ ...base, ...dependencies }).map((job) => job.name);

describe("createJobs", () => {
  it("builds no job for a role that is not started", () => {
    expect(names({})).toEqual([]);
  });

  it("builds the poll job for the listener role only", () => {
    expect(names({ listener })).toEqual(["email.poll"]);
  });

  it("builds the gate, the deliverer and the agent job for the processor role, and the reply run with its dependencies", () => {
    expect(names({ processor: { deliver } })).toEqual([
      "run-agent",
      "email.received",
      "email.deliver",
    ]);
    expect(names({ processor: { reply, deliver } })).toEqual([
      "run-agent",
      "email.received",
      "email.deliver",
      "email.process",
    ]);
  });

  it("builds the indexing and drift jobs for the indexer role only", () => {
    expect(names({ indexer })).toEqual(["knowledge.index", "knowledge.drift"]);
  });

  it("builds the jobs of every role that is started and none of the others", () => {
    expect(names({ listener, indexer })).toEqual([
      "email.poll",
      "knowledge.index",
      "knowledge.drift",
    ]);
  });
});
