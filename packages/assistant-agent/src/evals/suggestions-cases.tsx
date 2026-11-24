import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";
import type { RubricExpectation } from "./scope-cases";

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  response: "We are open Monday to Friday from 09:00 to 17:00.",
  examples: ["When are you open?"],
});

const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  response: "Refunds are possible within 30 days of purchase if the item is unused.",
});

/**
 * Cases for the workflow step that suggests questions: realistic incoming messages in the voice of
 * a colleague, client or manager, including statements and requests, checked with
 * `search_playbooks`, and reported as covered or not covered. A judge grades each answer, because
 * the messages differ between runs, so the criteria state what a correct answer does and not which
 * messages it picks.
 */
export const suggestionsCases = defineEvalCases([
  {
    id: "suggests-messages-and-reports-coverage",
    input: {
      conversation: [
        {
          role: "user",
          content: "What might people write to me that my playbooks do not cover yet?",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      criteria:
        "The agent suggests several realistic incoming messages written as a colleague, client or manager would write them, and at least one is a statement or a request and not a question. It says which messages the playbooks cover and which they do not. Messages that it calls covered are about opening hours or refunds, and messages that it calls not covered are about neither. It writes nothing to the playbooks.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 4: suggest messages, check them, report covered and not covered.",
    },
  },
  {
    id: "suggests-for-one-playbook",
    input: {
      conversation: [
        {
          role: "user",
          content: "What could a client write that my Refund policy playbook should answer?",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      criteria:
        "The agent suggests several realistic messages from a client about refunds, phrased in different ways, and at least one is a statement or a request such as asking for money back. It says which of them the Refund policy playbook covers. It does not invent refund terms that the playbook does not state, such as a different number of days.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 4: suggestions are phrased naturally and stay inside the facts of the playbook.",
    },
  },
  {
    id: "suggests-in-the-users-language",
    input: {
      conversation: [
        {
          role: "user",
          content: "Apa saja yang mungkin ditulis orang kepada saya terkait jam kantor?",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      criteria:
        "The agent answers in Indonesian and suggests several realistic messages about office hours. It says whether the Office hours playbook covers them.",
    } satisfies RubricExpectation,
    metadata: { note: "Rule: reply in the language of the user." },
  },
  {
    id: "no-playbooks-means-nothing-is-covered",
    input: {
      conversation: [
        { role: "user", content: "What might people write to me that my playbooks do not cover?" },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent says that the user has no playbooks yet, so nothing is covered. It does not claim that any message is covered, and it writes nothing. It may offer to help add a first playbook.",
    } satisfies RubricExpectation,
    metadata: { note: "Workflow step 1: do not guess about data that the tools do not return." },
  },
]);
