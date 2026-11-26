import { describe, expect, it } from "vitest";
import { NOTHING_FOUND_PATTERNS, anyOf, gradeReadsAndKeepsEmpty, gradeToolCalls } from "./graders";
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
