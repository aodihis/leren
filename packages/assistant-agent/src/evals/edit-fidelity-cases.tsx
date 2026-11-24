import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";
import type { RubricExpectation } from "./scope-cases";

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  response:
    "we r open mon-fri 9am to 5pm, closed on public holidays. pls call 021-555-0100 for urgent stuff",
});

const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  response:
    "Refunds are possible within 30 days of purchase if the item is unused. Send the order number and the refund goes back to the original payment method.",
});

/**
 * Cases for edit proposals that must match the source. The agent changes only what the user asks
 * for, keeps every fact of the stored text, adds none, shows the exact new text and asks before it
 * writes (workflow steps 3 and 5). A judge compares the proposal with the stored text, and the
 * criteria list the facts that must survive.
 */
export const editFidelityCases = defineEvalCases([
  {
    id: "better-wording-keeps-every-fact",
    input: {
      conversation: [
        {
          role: "user",
          content: "Improve the wording of my Office hours playbook, but keep all facts.",
        },
      ],
      playbooks: [OFFICE_HOURS],
    },
    expected: {
      criteria:
        "The agent shows a proposed new response that is better written and still says every fact of the stored text: open Monday to Friday, from 9am to 5pm (09:00 to 17:00 is the same), closed on public holidays, and call 021-555-0100 for urgent matters. It adds no new fact, such as Saturday hours, an email address or a different number. It asks whether to save it and calls no tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 3: when asked to improve the wording, keep every fact and add none.",
    },
  },
  {
    id: "shorter-text-keeps-every-fact",
    input: {
      conversation: [{ role: "user", content: "Make the Refund policy response shorter." }],
      playbooks: [REFUND],
    },
    expected: {
      criteria:
        "The agent shows a shorter response that keeps the facts of the stored text: refunds within 30 days, only for an unused item, the order number is needed, and the refund goes back to the original payment method. Any fact that it leaves out is named in the answer, so that nothing is dropped silently. It adds no fact. It asks whether to save it and calls no tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "Workflow step 3: change only what the user asks for, and keep the facts." },
  },
  {
    id: "translation-keeps-the-numbers",
    input: {
      conversation: [
        {
          role: "user",
          content: "Translate the response of my Office hours playbook into Indonesian.",
        },
      ],
      playbooks: [OFFICE_HOURS],
    },
    expected: {
      criteria:
        "The agent shows an Indonesian version of the response that keeps the days, the hours 9 to 5 (09:00 to 17:00), the closure on public holidays and the phone number 021-555-0100 exactly. It adds no fact. It asks whether to save it and calls no tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 3: a translation is an edit, so numbers and contact details stay exact.",
    },
  },
  {
    id: "one-requested-change-leaves-the-rest-alone",
    input: {
      conversation: [
        {
          role: "user",
          content: "Change the Refund policy so that refunds are possible within 14 days.",
        },
      ],
      playbooks: [REFUND],
    },
    expected: {
      criteria:
        "The agent shows the new response with 14 days instead of 30 days and keeps the rest of the text as it was: only for an unused item, the order number is needed, and the refund goes back to the original payment method. It changes nothing else, and it asks the user to confirm before it saves, in any wording, and calls no tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "Workflow step 3: change only what the user asks to change." },
  },
  {
    id: "missing-fact-is-asked-for-and-not-invented",
    input: {
      conversation: [
        {
          role: "user",
          content: "Add the shipping fee to my Refund policy playbook.",
        },
      ],
      playbooks: [REFUND],
    },
    expected: {
      criteria:
        "The agent notices that the user did not say what the shipping fee is or how the playbook should state it, and asks for that information. It does not invent an amount or a rule, and it calls no tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "Workflow step 3: if a fact is missing, ask for it." },
  },
]);
