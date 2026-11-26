import { describe, expect, it } from "vitest";
import {
  NOTHING_FOUND_PATTERNS,
  anyOf,
  gradeReadsAndKeepsEmpty,
  gradeStoreSize,
  gradeToolCalls,
  gradeWrite,
} from "./graders";
import type { WriteExpectation } from "./graders";
import type { AssistantEvalOutput, PlaybookFixture } from "./target";

const call = (name: string) => ({ name, input: {} });

const output = (names: string[], playbooks: PlaybookFixture[] = []): AssistantEvalOutput => ({
  text: "",
  toolCalls: names.map(call),
  playbooks,
});

/**
 * Every eval case expects to pass, so a grader that always passes also gives a green suite. These
 * tests feed each grader hand-built bad outputs and require it to fail.
 */
describe("gradeToolCalls", () => {
  it("fails when a required tool was not called", () => {
    const verdict = gradeToolCalls([call("get_message")], { mustCall: ["list_playbooks"] });

    expect(verdict).toMatchObject({ pass: false });
  });

  it("fails when a forbidden tool was called", () => {
    const verdict = gradeToolCalls([call("list_playbooks"), call("create_playbook")], {
      mustCall: ["list_playbooks"],
      mustNotCall: ["create_playbook|update_playbook"],
    });

    expect(verdict).toMatchObject({ pass: false });
  });

  it("accepts any alternative of a required pattern", () => {
    const verdict = gradeToolCalls([call("search_playbooks")], {
      mustCall: ["list_playbooks|get_playbook|search_playbooks"],
    });

    expect(verdict).toEqual({ pass: true });
  });

  it("matches a pattern against the whole tool name", () => {
    const verdict = gradeToolCalls([call("list_playbooks_extended")], {
      mustCall: ["list_playbooks"],
    });

    expect(verdict).toMatchObject({ pass: false });
  });

  it("passes when nothing is expected", () => {
    expect(gradeToolCalls([], undefined)).toEqual({ pass: true });
  });
});

describe("gradeReadsAndKeepsEmpty", () => {
  it("fails when the agent answered without reading the store", () => {
    expect(gradeReadsAndKeepsEmpty(output([]))).toMatchObject({ pass: false });
  });

  it("fails when the agent created a playbook in the empty store", () => {
    const created = { id: "pb-new" } as PlaybookFixture;

    const verdict = gradeReadsAndKeepsEmpty(
      output(["list_playbooks", "create_playbook"], [created]),
    );

    expect(verdict).toMatchObject({ pass: false });
  });

  it("passes when the agent read the store and left it empty", () => {
    expect(gradeReadsAndKeepsEmpty(output(["list_playbooks"]))).toEqual({ pass: true });
  });
});

const says = (text: string) => NOTHING_FOUND_PATTERNS.some((pattern) => pattern.test(text));

describe("NOTHING_FOUND_PATTERNS", () => {
  it.each([
    "You have no playbooks yet.",
    "There is no refund playbook.",
    "I couldn't find a playbook about that.",
    "I couldn’t find a playbook about office hours.",
    "You don’t have a refund playbook.",
    "You don't have any playbooks.",
    "The list is empty.",
  ])("accepts %j", (text) => {
    expect(says(text)).toBe(true);
  });

  it.each([
    "You have 2 playbooks: Office hours and Refund policy.",
    "Your refund playbook allows refunds within 30 days.",
  ])("rejects %j", (text) => {
    expect(says(text)).toBe(false);
  });
});

describe("anyOf", () => {
  it("matches text that any pattern matches, ignoring case", () => {
    expect(anyOf([/office hours/, /refund/]).test("Your REFUND policy")).toBe(true);
  });

  it("matches nothing for an empty list", () => {
    expect(anyOf([]).test("anything at all")).toBe(false);
  });
});

const write = (input: Record<string, unknown>, name = "create_playbook") => [{ name, input }];

describe("gradeWrite", () => {
  const expected: WriteExpectation = {
    tool: "create_playbook",
    includes: { topic: "Parking" },
    instants: { startsAt: ["2026-12-28T16:59:00.000Z", "2026-12-28T17:01:00.000Z"] },
    omits: ["instruction"],
  };

  const good = { topic: "Parking", startsAt: "2026-12-29T00:00:00+07:00" };

  it("passes a call with the right values, an equal instant in another offset and no extras", () => {
    expect(gradeWrite(write(good), expected)).toEqual({ pass: true });
  });

  it("fails when nothing was written", () => {
    expect(gradeWrite([], expected)).toMatchObject({ pass: false });
  });

  it("fails when another write tool was used", () => {
    expect(gradeWrite(write(good, "update_playbook"), expected)).toMatchObject({ pass: false });
  });

  it("fails when the agent wrote twice", () => {
    expect(gradeWrite([...write(good), ...write(good)], expected)).toMatchObject({ pass: false });
  });

  it("fails when an argument differs", () => {
    expect(gradeWrite(write({ ...good, topic: "Car park" }), expected)).toMatchObject({
      pass: false,
    });
  });

  it("fails when a date is outside its range", () => {
    expect(
      gradeWrite(write({ ...good, startsAt: "2026-12-29T00:00:00Z" }), expected),
    ).toMatchObject({
      pass: false,
    });
  });

  it("fails when an unrequested argument is named", () => {
    expect(gradeWrite(write({ ...good, instruction: "Be formal" }), expected)).toMatchObject({
      pass: false,
    });
  });

  it("passes when no write is expected", () => {
    expect(gradeWrite([], undefined)).toEqual({ pass: true });
  });
});

describe("gradeStoreSize", () => {
  it("fails when a playbook was saved although none was expected", () => {
    const created = { id: "pb-new" } as PlaybookFixture;

    expect(gradeStoreSize(output(["create_playbook"], [created]), 0)).toMatchObject({
      pass: false,
    });
  });

  it("passes when the store has the expected size", () => {
    expect(gradeStoreSize(output([]), 0)).toEqual({ pass: true });
  });

  it("passes when no size is expected", () => {
    expect(gradeStoreSize(output([]), undefined)).toEqual({ pass: true });
  });
});
