import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

/**
 * What the reply to a request for the list of playbooks must contain. `contains` are patterns that
 * must all match the reply, and `excludes` are patterns that must not match it.
 */
export type ListExpectation = {
  contains: readonly RegExp[];
  excludes?: readonly RegExp[];
};

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  information: "We are open Monday to Friday from 09:00 to 17:00.",
});

const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  information: "Refunds are possible within 30 days of purchase.",
});

const SHIPPING = playbook({
  id: "pb-shipping",
  topic: "Shipping days",
  information: "We ship on Tuesdays and Thursdays.",
  enabled: false,
});

/**
 * Cases for the content of the reply to a request for the list of playbooks. The reply must name
 * every playbook that the store holds and nothing else.
 */
export const listPlaybooksCases = defineEvalCases([
  {
    id: "names-every-playbook",
    input: {
      conversation: [{ role: "user", content: "Show me the list of my playbooks." }],
      playbooks: [OFFICE_HOURS, REFUND, SHIPPING],
    },
    expected: {
      contains: [/office hours/i, /refund policy/i, /shipping days/i],
    } satisfies ListExpectation,
    metadata: { note: "Good case: all three topics, including the disabled one, are listed." },
  },
  {
    id: "names-a-single-playbook",
    input: {
      conversation: [{ role: "user", content: "Which playbooks do I have?" }],
      playbooks: [REFUND],
    },
    expected: {
      contains: [/refund policy/i],
      excludes: [/office hours/i, /shipping days/i],
    } satisfies ListExpectation,
    metadata: { note: "Bad case: the reply must not invent playbooks that the store lacks." },
  },
  {
    id: "lists-only-disabled-playbooks",
    input: {
      conversation: [{ role: "user", content: "Which of my playbooks are switched off?" }],
      playbooks: [OFFICE_HOURS, REFUND, SHIPPING],
    },
    expected: {
      contains: [/shipping days/i],
      excludes: [/office hours/i, /refund policy/i],
    } satisfies ListExpectation,
    metadata: { note: "Bad case: the filter must leave out the playbooks that are on." },
  },
]);
