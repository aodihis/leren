import { describe, expect, it } from "vitest";

import { isKnowledgeIndexable, toEmbeddingText, toVectorMetadata } from "./indexing";
import type { KnowledgeIndexable } from "./indexing";

const NOW = new Date("2026-06-15T12:00:00Z");

const item: KnowledgeIndexable = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  ruleId: "33333333-3333-4333-8333-333333333333",
  topic: "Opening hours",
  examples: ["When are you open?"],
  response: "We are open from 9 to 5.",
  approvalStatus: "approved",
  validFrom: null,
  validUntil: null,
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("isKnowledgeIndexable", () => {
  it("indexes an approved item without a window", () => {
    expect(isKnowledgeIndexable(item, NOW)).toBe(true);
  });

  it.each(["draft", "archived"] as const)("does not index a %s item", (approvalStatus) => {
    expect(isKnowledgeIndexable({ ...item, approvalStatus }, NOW)).toBe(false);
  });

  it("indexes an item whose window has not started", () => {
    const future = new Date("2026-07-01T00:00:00Z");

    expect(isKnowledgeIndexable({ ...item, validFrom: future }, NOW)).toBe(true);
  });

  it("indexes an item whose window ends exactly now and not after", () => {
    expect(isKnowledgeIndexable({ ...item, validUntil: NOW }, NOW)).toBe(true);
    expect(isKnowledgeIndexable({ ...item, validUntil: new Date(NOW.getTime() - 1) }, NOW)).toBe(
      false,
    );
  });
});

describe("toEmbeddingText", () => {
  it("joins the topic, the response and the examples", () => {
    expect(toEmbeddingText(item)).toBe(
      "Opening hours\n\nWe are open from 9 to 5.\n\nWhen are you open?",
    );
  });
});

describe("toVectorMetadata", () => {
  it("omits open bounds", () => {
    expect(toVectorMetadata(item)).toEqual({
      knowledgeId: item.id,
      userId: item.userId,
      ruleId: item.ruleId,
      type: "knowledge",
      updatedAt: item.updatedAt.getTime(),
    });
  });

  it("stores the bounds as epoch milliseconds", () => {
    const validFrom = new Date("2026-06-01T00:00:00Z");
    const validUntil = new Date("2026-07-01T00:00:00Z");

    expect(toVectorMetadata({ ...item, validFrom, validUntil })).toMatchObject({
      validFrom: validFrom.getTime(),
      validUntil: validUntil.getTime(),
    });
  });
});
