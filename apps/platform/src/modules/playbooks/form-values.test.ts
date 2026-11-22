import { describe, expect, it } from "vitest";

import { getNewPlaybookValues, toFormValues, toRequestBody } from "./form-values";
import type { Playbook } from "./types";

const playbook: Playbook = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: "Holiday hours",
  examples: ["When are you back?", "Are you open?"],
  response: "We are closed until 2 January.",
  restrictions: "Do not promise a delivery date.",
  contacts: ["dewi@example.com", "@Don"],
  startsAt: "2026-12-01T02:00:00.000Z",
  endsAt: null,
  timezone: "Asia/Jakarta",
  enabled: true,
  periodStatus: "scheduled",
  usable: false,
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
      replyMode: "draft",
    },
  ],
};

describe("toRequestBody", () => {
  it("converts a stored playbook to the same request body after a round trip", () => {
    const { id: _id, periodStatus: _periodStatus, usable: _usable, ...body } = playbook;

    expect(toRequestBody(toFormValues(playbook))).toEqual(body);
  });

  it("splits the allowlist, aliases and contacts on new lines and commas and drops blanks", () => {
    const values = getNewPlaybookValues("UTC");

    const body = toRequestBody({
      ...values,
      contacts: "a@x.com,\n\n @Don ,",
      email: {
        ...values.email,
        senderAllowlist: "a@x.com,\n\n @y.org ,",
        mentionAliases: "Bal, ,Iqbal\nIk",
      },
    });

    expect(body.contacts).toEqual(["a@x.com", "@Don"]);
    expect(body.conditions[0]?.senderAllowlist).toEqual(["a@x.com", "@y.org"]);
    expect(body.conditions[0]?.mentionAliases).toEqual(["Bal", "Iqbal", "Ik"]);
  });

  it("drops blank examples", () => {
    const values = { ...getNewPlaybookValues("UTC"), examples: "One\n\n  \nTwo" };

    expect(toRequestBody(values).examples).toEqual(["One", "Two"]);
  });

  it("reads the dates in the chosen timezone and leaves empty ones open", () => {
    const values = { ...getNewPlaybookValues("Asia/Jakarta"), startsAt: "2026-12-01T09:00" };

    expect(toRequestBody(values)).toMatchObject({
      startsAt: "2026-12-01T02:00:00.000Z",
      endsAt: null,
    });
  });
});

describe("toFormValues", () => {
  it("shows the stored instants as wall clock time in the playbook's timezone", () => {
    expect(toFormValues(playbook)).toMatchObject({ startsAt: "2026-12-01T09:00", endsAt: "" });
  });
});
