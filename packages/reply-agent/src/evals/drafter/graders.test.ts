import { describe, expect, it } from "vitest";
import { PROMPT_CANARY } from "../../pipeline/guardrails";
import {
  gradeCitesExpected,
  gradeDraftChecks,
  gradeForbiddenContent,
  gradeKnownIds,
  gradeNoWriteToolsOffered,
  gradeOnlyReadCalls,
  gradeOutcome,
  gradeRequiredFacts,
  gradeSearchBudget,
  gradeSearchedEachQuestion,
  gradeValidJson,
  gradeWithinTurns,
} from "./graders";
import type { DrafterInput, DrafterOutput } from "./target";

const input: DrafterInput = {
  email: { from: "a@example.com", subject: "s", body: "b" },
  category: "project_question",
  questions: ["One?", "Two?"],
  playbooks: [{ id: "p1", topic: "t", information: "i" }],
};

const answer = (body: string, citations: string[] = ["p1"]) =>
  ({ outcome: "answer", reason: "", body, citations }) as const;

const output = (fields: Partial<DrafterOutput> = {}): DrafterOutput => ({
  raw: "{}",
  answer: answer("The deadline is 28 November."),
  toolCalls: [],
  offeredTools: ["search_playbooks", "get_playbook"],
  readableIds: ["p1"],
  foundIds: ["p1"],
  turnLimitReached: false,
  ...fields,
});

const call = (name: string, fields: Record<string, unknown> = {}) => ({ name, input: fields });

/**
 * Every eval case expects to pass, so a grader that always passes also gives a green suite. These
 * tests feed each grader a hand-built bad output and require it to fail.
 */
describe("drafter graders", () => {
  it("fails when a write tool is offered", () => {
    expect(gradeNoWriteToolsOffered(output({ offeredTools: ["update_playbook"] })).pass).toBe(
      false,
    );
  });

  it("fails when a tool other than the playbook reads is called", () => {
    expect(gradeOnlyReadCalls(output({ toolCalls: [call("create_playbook")] })).pass).toBe(false);
  });

  it("fails when there are fewer searches than questions", () => {
    const verdict = gradeSearchedEachQuestion(
      input,
      output({ toolCalls: [call("search_playbooks")] }),
    );

    expect(verdict.pass).toBe(false);
  });

  it("fails when the search budget is exceeded", () => {
    const toolCalls = Array.from({ length: 4 }, () => call("search_playbooks"));

    expect(gradeSearchBudget(output({ toolCalls }), 3).pass).toBe(false);
  });

  it("fails when get_playbook reads an id that the search could not return", () => {
    const toolCalls = [call("get_playbook", { playbookId: "p9" })];

    expect(gradeKnownIds(output({ toolCalls })).pass).toBe(false);
  });

  it("fails when the turn limit was reached", () => {
    expect(gradeWithinTurns(output({ turnLimitReached: true })).pass).toBe(false);
  });

  it("fails when the answer cannot be read", () => {
    expect(gradeValidJson(output({ answer: undefined })).pass).toBe(false);
  });

  it("fails when the outcome differs", () => {
    expect(gradeOutcome(output(), "escalate").pass).toBe(false);
  });

  it("fails when the outcome is in none of the allowed outcomes", () => {
    expect(gradeOutcome(output({ answer: undefined }), ["answer", "escalate"]).pass).toBe(false);
  });

  it("fails when an answer cites a playbook that was not found", () => {
    expect(gradeDraftChecks(output({ answer: answer("Body.", ["p9"]) })).pass).toBe(false);
  });

  it("fails when an expected citation is missing", () => {
    expect(gradeCitesExpected(output(), ["p1", "p2"]).pass).toBe(false);
  });

  it("fails when a required fact is missing", () => {
    expect(gradeRequiredFacts(output(), [/17:00/]).pass).toBe(false);
  });

  it("fails when a forbidden pattern is in the body", () => {
    expect(gradeForbiddenContent(output(), [/28 November/]).pass).toBe(false);
  });

  it("fails when the output repeats the prompt canary", () => {
    expect(gradeForbiddenContent(output({ raw: PROMPT_CANARY }), []).pass).toBe(false);
  });
});
