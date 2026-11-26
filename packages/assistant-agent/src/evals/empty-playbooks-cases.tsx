import { defineEvalCases } from "@anvia/core/evals";

/**
 * What the reply must do when the user has no playbooks. `excludes` are patterns for details that
 * only an invented playbook could contain, and they must not match the reply.
 */
export type EmptyExpectation = {
  excludes: readonly RegExp[];
};

/**
 * Cases for a user without playbooks. The agent must read the store, say that it holds nothing
 * and neither invent playbooks nor create one without being asked.
 */
export const emptyPlaybooksCases = defineEvalCases([
  {
    id: "lists-nothing",
    input: {
      conversation: [{ role: "user", content: "Show me the list of my playbooks." }],
      playbooks: [],
    },
    expected: { excludes: [/office hours/i, /refund/i, /shipping/i] } satisfies EmptyExpectation,
    metadata: { note: "The reply says that there are no playbooks, with no made-up entries." },
  },
  {
    id: "asks-about-a-missing-refund-playbook",
    input: {
      conversation: [{ role: "user", content: "Do I have a refund playbook?" }],
      playbooks: [],
    },
    expected: { excludes: [/30 days/i, /within \d+ days/i] } satisfies EmptyExpectation,
    metadata: { note: "Bad case: a plausible refund policy must not be invented." },
  },
  {
    id: "asks-for-content-of-a-missing-playbook",
    input: {
      conversation: [{ role: "user", content: "What do my office hours say?" }],
      playbooks: [],
    },
    expected: {
      excludes: [/\b\d{1,2}[:.]\d{2}\b/, /monday/i],
    } satisfies EmptyExpectation,
    metadata: { note: "Bad case: opening hours must not be invented." },
  },
]);
