import { describe, expect, it } from "vitest";

import { getNewRuleValues, toFormValues, toRequestBody } from "./form-values";
import type { Rule } from "./types";

const rule: Rule = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Holiday",
  enabled: true,
  startsAt: "2026-12-01T02:00:00.000Z",
  endsAt: null,
  timezone: "Asia/Jakarta",
  status: "scheduled",
  conditions: [
    {
      channel: "email",
      senderMode: "allowlist",
      senderAllowlist: ["boss@acme.com", "@partner.org"],
      replyWhenTo: true,
      replyWhenCc: false,
      replyWhenBcc: false,
      requireSoleRecipient: false,
      mentionOverrides: true,
      mentionDetection: "alias",
      mentionAliases: ["Bal", "Mr. Iqbal"],
      threadMode: "both",
      skipBulkMail: true,
    },
  ],
};

describe("toRequestBody", () => {
  it("converts a stored rule to the same request body after a round trip", () => {
    const { id: _id, status: _status, ...body } = rule;

    expect(toRequestBody(toFormValues(rule))).toEqual(body);
  });

  it("splits the allowlist and aliases on new lines and commas and drops blanks", () => {
    const values = getNewRuleValues("UTC");

    const body = toRequestBody({
      ...values,
      email: {
        ...values.email,
        senderAllowlist: "a@x.com,\n\n @y.org ,",
        mentionAliases: "Bal, ,Iqbal\nIk",
      },
    });

    expect(body.conditions[0]?.senderAllowlist).toEqual(["a@x.com", "@y.org"]);
    expect(body.conditions[0]?.mentionAliases).toEqual(["Bal", "Iqbal", "Ik"]);
  });

  it("reads the dates in the chosen timezone and leaves empty ones open", () => {
    const values = { ...getNewRuleValues("Asia/Jakarta"), startsAt: "2026-12-01T09:00" };

    expect(toRequestBody(values)).toMatchObject({
      startsAt: "2026-12-01T02:00:00.000Z",
      endsAt: null,
    });
  });
});

describe("toFormValues", () => {
  it("shows the stored instants as wall clock time in the rule's timezone", () => {
    expect(toFormValues(rule)).toMatchObject({ startsAt: "2026-12-01T09:00", endsAt: "" });
  });
});
