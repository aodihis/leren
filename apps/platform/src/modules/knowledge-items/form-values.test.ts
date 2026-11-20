import { describe, expect, it } from "vitest";

import { getNewKnowledgeValues, toFormValues, toRequestBody } from "./form-values";
import type { KnowledgeItem } from "./types";

const item: KnowledgeItem = {
  id: "11111111-1111-4111-8111-111111111111",
  ruleId: "22222222-2222-4222-8222-222222222222",
  topic: "Project status",
  examples: ["How is it going?", "When is the launch?"],
  response: "On track.",
  restrictions: "No budget.",
  validFrom: "2026-12-01T02:00:00.000Z",
  validUntil: null,
  approvalStatus: "draft",
  approvedAt: null,
  usable: false,
  contacts: ["dewi@example.com", "@Don"],
};

describe("knowledge form values", () => {
  it("shows the validity bounds in the timezone of the rule and one example per line", () => {
    expect(toFormValues(item, "Asia/Jakarta")).toEqual({
      ruleId: item.ruleId,
      topic: "Project status",
      examples: "How is it going?\nWhen is the launch?",
      response: "On track.",
      restrictions: "No budget.",
      validFrom: "2026-12-01T09:00",
      validUntil: "",
      contacts: "dewi@example.com, @Don",
    });
  });

  it("reads the bounds in the timezone of the rule, keeps an empty bound open and drops blank examples and contacts", () => {
    const values = {
      ...getNewKnowledgeValues(item.ruleId),
      topic: "Status",
      response: "On track.",
      examples: "First?\n\n  \nSecond?",
      validFrom: "2026-12-01T09:00",
      contacts: "a@example.com, @Don\n b@example.com,, ",
    };

    expect(toRequestBody(values, "Asia/Jakarta")).toEqual({
      ruleId: item.ruleId,
      topic: "Status",
      examples: ["First?", "Second?"],
      response: "On track.",
      restrictions: "",
      validFrom: "2026-12-01T02:00:00.000Z",
      validUntil: null,
      contacts: ["a@example.com", "@Don", "b@example.com"],
    });
  });
});
