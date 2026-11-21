import { KNOWLEDGE_INDEX_QUEUE } from "@leren/knowledge";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createKnowledgeDriftJob, createKnowledgeIndexJob, KNOWLEDGE_DRIFT_QUEUE } from "./job";
import { repairKnowledgeDrift, syncKnowledgeItem } from "./service";
import type { KnowledgeIndexDependencies } from "./service";

vi.mock("./service", () => ({
  syncKnowledgeItem: vi.fn(),
  repairKnowledgeDrift: vi.fn(),
}));

const dependencies = {} as KnowledgeIndexDependencies;
const ITEM_ID = "11111111-1111-4111-8111-111111111111";

function createContext() {
  return {
    jobId: "job-1",
    attempt: 1,
    idempotencyKey: "key-1",
    signal: new AbortController().signal,
  };
}

describe("knowledge index job", () => {
  beforeEach(() => {
    vi.mocked(syncKnowledgeItem).mockResolvedValue("indexed");
  });

  it("consumes the knowledge.index queue", () => {
    expect(createKnowledgeIndexJob(dependencies).name).toBe(KNOWLEDGE_INDEX_QUEUE);
  });

  it("synchronises the item named by the message", async () => {
    const context = createContext();

    await createKnowledgeIndexJob(dependencies).handler({ itemId: ITEM_ID }, context);

    expect(syncKnowledgeItem).toHaveBeenCalledExactlyOnceWith(dependencies, ITEM_ID, {
      signal: context.signal,
    });
  });

  it("lets a failure reach the worker so the message is retried", async () => {
    vi.mocked(syncKnowledgeItem).mockRejectedValue(new Error("Qdrant is down"));

    await expect(
      createKnowledgeIndexJob(dependencies).handler({ itemId: ITEM_ID }, createContext()),
    ).rejects.toThrow("Qdrant is down");
  });

  it("rejects a payload whose item id is not a UUID", () => {
    const { schema } = createKnowledgeIndexJob(dependencies);

    expect(schema.safeParse({ itemId: "not-a-uuid" }).success).toBe(false);
    expect(schema.safeParse({ itemId: ITEM_ID }).success).toBe(true);
  });
});

describe("knowledge drift job", () => {
  it("repairs the drift with the signal of the job", async () => {
    const context = createContext();

    vi.mocked(repairKnowledgeDrift).mockResolvedValue({
      drift: { missing: ["a"], stale: [], orphaned: ["b"] },
      repaired: 2,
    });

    const job = createKnowledgeDriftJob(dependencies);

    await job.handler({}, context);

    expect(job.name).toBe(KNOWLEDGE_DRIFT_QUEUE);
    expect(repairKnowledgeDrift).toHaveBeenCalledExactlyOnceWith(dependencies, {
      signal: context.signal,
    });
  });
});
