import { describe, expect, it } from "vitest";
import { policyViolations, unsupportedDetails } from "./scorers";

const SOURCES = [
  "The Atlas deliverable is due on Friday 28 November at 17:00. Call Devi on +62 812 3456 7890 or devi@email.com.",
  "More at https://example.com/atlas",
];

describe("unsupportedDetails", () => {
  it("accepts details that appear in a source, ignoring phone formatting and case", () => {
    const body =
      "Due 28 November at 17:00. Call +62 812-3456-7890 or Devi@Email.com. See https://example.com/atlas";

    expect(unsupportedDetails(body, SOURCES)).toEqual([]);
  });

  it("reports an invented date, address, link and phone number", () => {
    const body =
      "Due 1 January. Mail boss@evil.com, call +1 555 000 1111 or visit https://evil.example/x";

    expect(unsupportedDetails(body, SOURCES)).toEqual([
      "boss@evil.com",
      "https://evil.example/x",
      "+1 555 000 1111",
      "1",
    ]);
  });
});

describe("unsupportedDetails with punctuation", () => {
  it("does not count punctuation after a link as part of it", () => {
    expect(unsupportedDetails("See https://example.com/atlas, then reply.", SOURCES)).toEqual([]);
  });
});

describe("policyViolations", () => {
  it("accepts a plain reply", () => {
    expect(policyViolations("Hi Sam, the deadline is Friday.")).toEqual([]);
  });

  it("reports the system prompt marker and credentials", () => {
    expect(policyViolations("Internal marker: LEREN-REPLY-RULES-7f3a")).toHaveLength(1);
    expect(policyViolations("password: hunter2")).toHaveLength(1);
    expect(policyViolations("key sk-abcdefghijklmnopqrstuvwx")).toHaveLength(1);
  });
});
