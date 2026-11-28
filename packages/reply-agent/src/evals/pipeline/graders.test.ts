import { describe, expect, it } from "vitest";
import type { ReplyResult, Triage } from "../../pipeline/types";
import {
  gradeCategory,
  gradeCitations,
  gradeConfidence,
  gradeEscalation,
  gradeFlags,
  gradeForbiddenContent,
  gradeLeftOutReported,
  gradeOnlyReadable,
  gradeOutcome,
  gradeQuestionCount,
  gradeRequiredFacts,
  gradeSteps,
} from "./graders";
import type { PipelineCaseOutput } from "./target";

const triage: Triage = {
  category: "project_question",
  questions: ["When is the deadline?"],
  injectionSuspected: false,
  addressesUser: true,
  confidence: 0.9,
};

const playbook = { id: "p1", topic: "t", information: "i" };

const answered: ReplyResult = {
  outcome: "answer",
  body: "The deadline is 28 November.",
  citations: ["p1"],
  reasons: [],
  triage,
  playbooks: [playbook],
  evaluations: [{ stage: "content", pass: true, issues: [] }],
  revisions: 0,
};

const output = (result: Partial<ReplyResult> = {}, readableIds = ["p1"]): PipelineCaseOutput => ({
  result: { ...answered, ...result },
  readableIds,
});

const escalated = output({ outcome: "escalate", body: undefined, citations: [], reasons: ["x"] });

/**
 * Every eval case expects to pass, so a grader that always passes also gives a green suite. These
 * tests feed each grader a hand-built bad output and require it to fail.
 */
describe("pipeline graders", () => {
  it("grades the category", () => {
    expect(gradeCategory(output(), "project_question").pass).toBe(true);
    expect(gradeCategory(output(), "urgent").pass).toBe(false);
    expect(gradeCategory(output(), ["other", "project_question"]).pass).toBe(true);
    expect(gradeCategory(output(), ["other", "informational"]).pass).toBe(false);
  });

  it("grades the number of questions", () => {
    expect(gradeQuestionCount(output(), 1).pass).toBe(true);
    expect(gradeQuestionCount(output(), 2).pass).toBe(false);
  });

  it("grades only the flags that the case names", () => {
    expect(gradeFlags(output(), { addressesUser: true }).pass).toBe(true);
    expect(gradeFlags(output(), { injectionSuspected: true }).pass).toBe(false);
  });

  it("grades the side of the confidence threshold", () => {
    const unsure = output({ triage: { ...triage, confidence: 0.4 } });

    expect(gradeConfidence(output(), true).pass).toBe(true);
    expect(gradeConfidence(unsure, true).pass).toBe(false);
    expect(gradeConfidence(output(), false).pass).toBe(false);
  });

  it("grades the outcome", () => {
    expect(gradeOutcome(output(), ["answer", "escalate"]).pass).toBe(true);
    expect(gradeOutcome(output(), "escalate").pass).toBe(false);
  });

  it("fails citations that differ from the expected set or were not found", () => {
    expect(gradeCitations(output(), ["p1"]).pass).toBe(true);
    expect(gradeCitations(output(), ["p1", "p2"]).pass).toBe(false);
    expect(gradeCitations(output({ citations: ["p1", "p9"] }), undefined).pass).toBe(false);
  });

  it("fails a playbook that the tools could not return", () => {
    expect(gradeOnlyReadable(output({}, ["p2"])).pass).toBe(false);
  });

  it("fails a missing fact and a forbidden one", () => {
    expect(gradeRequiredFacts(output(), [/5 December/]).pass).toBe(false);
    expect(gradeForbiddenContent(output(), [/28 November/]).pass).toBe(false);
  });

  it("fails an answer that leaves out a question without naming it", () => {
    const named = output({ reasons: ["The budget question is not covered."] });

    expect(gradeLeftOutReported(output(), true).pass).toBe(false);
    expect(gradeLeftOutReported(named, true).pass).toBe(true);
  });

  it("fails an escalation without a reason or with a body", () => {
    expect(gradeEscalation(escalated).pass).toBe(true);
    expect(gradeEscalation(output({ outcome: "escalate", reasons: [] })).pass).toBe(false);
  });

  it("fails a stage that ran after triage ended the run", () => {
    expect(gradeSteps(output({ outcome: "ignore" }), undefined).pass).toBe(false);
  });

  it("fails an answer whose last content draft did not pass", () => {
    const failed = output({ evaluations: [{ stage: "content", pass: false, issues: ["x"] }] });

    expect(gradeSteps(failed, undefined).pass).toBe(false);
  });

  it("fails a style stage that ran when it should be skipped, or did not run when it should", () => {
    const styled = output({
      evaluations: [
        { stage: "content", pass: true, issues: [] },
        { stage: "style", pass: true, issues: [] },
      ],
    });

    expect(gradeSteps(styled, "skipped").pass).toBe(false);
    expect(gradeSteps(output(), "passed").pass).toBe(false);
    expect(gradeSteps(styled, "passed").pass).toBe(true);
  });
});
