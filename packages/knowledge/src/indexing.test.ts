import { describe, expect, it } from "vitest";

import { isKnowledgeIndexable, toEmbeddingText, toVectorMetadata } from "./indexing";
import type { KnowledgeIndexable } from "./indexing";

const NOW = new Date("2026-06-15T12:00:00Z");

const playbook: KnowledgeIndexable = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  topic: "Opening hours",
  enabled: true,
  information: "We are open from 9 to 5.",
  startsAt: null,
  endsAt: null,
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("isKnowledgeIndexable", () => {
  it("indexes an enabled playbook without a window", () => {
    expect(isKnowledgeIndexable(playbook, NOW)).toBe(true);
  });

  it("does not index a disabled playbook", () => {
    expect(isKnowledgeIndexable({ ...playbook, enabled: false }, NOW)).toBe(false);
  });

  it("indexes a playbook whose window has not started", () => {
    const future = new Date("2026-07-01T00:00:00Z");

    expect(isKnowledgeIndexable({ ...playbook, startsAt: future }, NOW)).toBe(true);
  });

  it("indexes a playbook whose window ends exactly now and not after", () => {
    expect(isKnowledgeIndexable({ ...playbook, endsAt: NOW }, NOW)).toBe(true);
    expect(isKnowledgeIndexable({ ...playbook, endsAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(
      false,
    );
  });
});

describe("toEmbeddingText", () => {
  it("joins the topic and the information", () => {
    expect(toEmbeddingText(playbook)).toBe("Opening hours\n\nWe are open from 9 to 5.");
  });
});

describe("toVectorMetadata", () => {
  it("omits open bounds", () => {
    expect(toVectorMetadata(playbook)).toEqual({
      playbookId: playbook.id,
      userId: playbook.userId,
      type: "knowledge",
      updatedAt: playbook.updatedAt.getTime(),
    });
  });

  it("stores the bounds as epoch milliseconds", () => {
    const startsAt = new Date("2026-06-01T00:00:00Z");
    const endsAt = new Date("2026-07-01T00:00:00Z");

    expect(toVectorMetadata({ ...playbook, startsAt, endsAt })).toMatchObject({
      startsAt: startsAt.getTime(),
      endsAt: endsAt.getTime(),
    });
  });
});
