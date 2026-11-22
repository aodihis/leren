import { describe, expect, it } from "vitest";

import { evaluateEmailConditions } from "./conditions";
import type { EmailConditions, EmailFacts, EmailRecipient } from "./conditions";

const user: EmailRecipient = { email: "me@example.com", names: ["Iqbal"] };

const permissive: EmailConditions = {
  senderMode: "any",
  senderAllowlist: [],
  replyWhenTo: true,
  replyWhenCc: true,
  replyWhenBcc: true,
  requireSoleRecipient: false,
  mentionOverrides: false,
  mentionDetection: "alias",
  mentionAliases: [],
  threadMode: "both",
  skipBulkMail: true,
};

const direct: EmailFacts = {
  from: "boss@acme.com",
  to: ["me@example.com"],
  cc: [],
  body: "Please report the status.",
  isReply: false,
  isBulk: false,
};

function evaluate(conditions: Partial<EmailConditions>, email: Partial<EmailFacts>) {
  return evaluateEmailConditions({ ...permissive, ...conditions }, { ...direct, ...email }, user);
}

describe("evaluateEmailConditions", () => {
  describe("bulk mail", () => {
    it("skips bulk mail when the rule skips it", () => {
      expect(evaluate({}, { isBulk: true })).toEqual({ outcome: "skip", reason: "bulk_mail" });
    });

    it("handles bulk mail when the rule does not skip it", () => {
      expect(evaluate({ skipBulkMail: false }, { isBulk: true }).outcome).toBe("handle");
    });
  });

  describe("sender", () => {
    const allowlist = {
      senderMode: "allowlist",
      senderAllowlist: ["Boss@acme.com", "@partner.org"],
    } as const;

    it.each([
      ["an exact address regardless of case", "BOSS@ACME.COM", "handle"],
      ["an address on an allowed domain", "anyone@partner.org", "handle"],
      ["an address on a different domain", "x@evil.com", "skip"],
      ["a look-alike of an allowed address", "notboss@acme.com", "skip"],
    ] as const)("allowlist mode treats %s", (_name, from, outcome) => {
      expect(evaluate(allowlist, { from }).outcome).toBe(outcome);
    });

    it("reports sender_not_allowed", () => {
      expect(evaluate(allowlist, { from: "x@evil.com" }).reason).toBe("sender_not_allowed");
    });

    it("skips everyone when the allowlist is empty", () => {
      expect(evaluate({ senderMode: "allowlist" }, {}).outcome).toBe("skip");
    });

    it("accepts any sender in any mode", () => {
      expect(evaluate({}, { from: "stranger@nowhere.net" }).outcome).toBe("handle");
    });
  });

  describe("thread", () => {
    it.each([
      ["new", false, "handle"],
      ["new", true, "skip"],
      ["reply", false, "skip"],
      ["reply", true, "handle"],
      ["both", false, "handle"],
      ["both", true, "handle"],
    ] as const)("mode %s with isReply=%s gives %s", (threadMode, isReply, outcome) => {
      expect(evaluate({ threadMode }, { isReply }).outcome).toBe(outcome);
    });

    it("reports thread_mode", () => {
      expect(evaluate({ threadMode: "new" }, { isReply: true }).reason).toBe("thread_mode");
    });
  });

  describe("recipient role", () => {
    const toOnly = { replyWhenCc: false, replyWhenBcc: false } as const;

    it("handles a To recipient", () => {
      expect(evaluate(toOnly, {})).toEqual({ outcome: "handle", reason: "recipient" });
    });

    it("skips a Cc recipient when Cc is off", () => {
      const email = { to: ["other@acme.com"], cc: ["ME@example.com"] };
      expect(evaluate(toOnly, email)).toEqual({ outcome: "skip", reason: "recipient_role" });
    });

    it("treats an address in neither To nor Cc as Bcc", () => {
      const email = { to: ["a@acme.com"], cc: ["b@acme.com"] };
      expect(evaluate(toOnly, email)).toEqual({ outcome: "skip", reason: "recipient_role" });
      expect(evaluate({ replyWhenCc: false, replyWhenBcc: true }, email).outcome).toBe("handle");
    });

    it("skips a To recipient when To is off", () => {
      expect(evaluate({ replyWhenTo: false }, {}).reason).toBe("recipient_role");
    });
  });

  describe("sole recipient", () => {
    const sole = { requireSoleRecipient: true } as const;

    it("handles the only recipient", () => {
      expect(evaluate(sole, {}).outcome).toBe("handle");
    });

    it("skips a To recipient when another address is in To", () => {
      const email = { to: ["me@example.com", "x@acme.com"] };
      expect(evaluate(sole, email)).toEqual({ outcome: "skip", reason: "not_sole_recipient" });
    });

    it("skips a To recipient when another address is in Cc", () => {
      const email = { cc: ["x@acme.com"] };
      expect(evaluate(sole, email).reason).toBe("not_sole_recipient");
    });

    it("does not apply to a Cc recipient", () => {
      const email = { to: ["x@acme.com"], cc: ["me@example.com"] };
      expect(evaluate(sole, email).outcome).toBe("handle");
    });
  });

  describe("mention override", () => {
    const blast: Partial<EmailFacts> = { to: ["a@acme.com"], cc: ["me@example.com"] };
    const overriding = { replyWhenCc: false, mentionOverrides: true } as const;

    it("handles a blocked message that mentions the user by name", () => {
      const email = { ...blast, body: "Hi Iqbal, can you report the status?" };
      expect(evaluate(overriding, email)).toEqual({ outcome: "handle", reason: "mention" });
    });

    it("handles a mention of a configured alias", () => {
      const email = { ...blast, body: "Hi Bal, status?" };
      expect(evaluate({ ...overriding, mentionAliases: ["Bal"] }, email).reason).toBe("mention");
    });

    it("skips a blocked message with no mention", () => {
      const email = { ...blast, body: "Hi all, what about the project?" };
      expect(evaluate(overriding, email)).toEqual({ outcome: "skip", reason: "recipient_role" });
    });

    it("ignores a mention when the override is off", () => {
      const email = { ...blast, body: "Hi Iqbal, status?" };
      expect(evaluate({ replyWhenCc: false }, email).outcome).toBe("skip");
    });

    it("asks for a model check when no alias matches and the rule allows it", () => {
      const email = { ...blast, body: "Hi all, what about the project?" };
      const conditions = { ...overriding, mentionDetection: "alias_then_llm" } as const;
      expect(evaluate(conditions, email)).toEqual({
        outcome: "check_mention",
        reason: "recipient_role",
      });
    });

    it("does not ask for a model check when an alias already matched", () => {
      const email = { ...blast, body: "Hi Iqbal, status?" };
      const conditions = { ...overriding, mentionDetection: "alias_then_llm" } as const;
      expect(evaluate(conditions, email).outcome).toBe("handle");
    });

    it("does not override bulk mail, sender or thread conditions", () => {
      const email = { ...blast, body: "Hi Iqbal, status?" };
      expect(evaluate(overriding, { ...email, isBulk: true }).reason).toBe("bulk_mail");
      expect(evaluate({ ...overriding, threadMode: "reply" }, email).reason).toBe("thread_mode");
      const restricted = { ...overriding, senderMode: "allowlist" } as const;
      expect(evaluate(restricted, email).reason).toBe("sender_not_allowed");
    });
  });
});
