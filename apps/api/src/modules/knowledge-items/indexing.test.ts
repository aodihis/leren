import type { Logger } from "@leren/logger";
import { describe, expect, it, vi } from "vitest";

import { createKnowledgeIndexRequester } from "./indexing";

function createLogger() {
  const error = vi.fn();

  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error,
    fatal: vi.fn(),
    child: () => logger,
  };

  return { logger, error };
}

describe("createKnowledgeIndexRequester", () => {
  it("publishes the item id to the knowledge.index queue", async () => {
    const queue = { publish: vi.fn().mockResolvedValue(undefined) };

    await createKnowledgeIndexRequester(queue, createLogger().logger)("item-1");

    expect(queue.publish).toHaveBeenCalledExactlyOnceWith("knowledge.index", { itemId: "item-1" });
  });

  it("logs a failed publish instead of throwing", async () => {
    const queue = { publish: vi.fn().mockRejectedValue(new Error("broker is down")) };
    const { logger, error } = createLogger();

    await expect(createKnowledgeIndexRequester(queue, logger)("item-1")).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
  });
});
