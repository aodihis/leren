import { defineEvalCases } from "@anvia/core/evals";
import type { ToolExpectation } from "./graders";
import { playbook } from "./target";

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

const WRITE_TOOLS = "create_playbook|update_playbook";

/**
 * Cases for which tools the agent calls. They protect one rule: the agent reads the user's data
 * with a tool instead of answering from memory, and a question never changes data.
 */
export const toolCallsCases = defineEvalCases([
  {
    id: "lists-playbooks",
    input: {
      conversation: [{ role: "user", content: "Which playbooks do I have?" }],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      mustCall: ["list_playbooks"],
      mustNotCall: [WRITE_TOOLS],
    } satisfies ToolExpectation,
    metadata: { note: "The list of playbooks is the user's data, so it needs a tool call." },
  },
  {
    id: "reads-one-playbook",
    input: {
      conversation: [{ role: "user", content: "What does my refund playbook say?" }],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      mustCall: ["list_playbooks|get_playbook|search_playbooks"],
      mustNotCall: [WRITE_TOOLS],
    } satisfies ToolExpectation,
    metadata: { note: "The content of one playbook is read, not recalled." },
  },
  {
    id: "explains-playbook-fields-from-the-field-guide",
    input: {
      conversation: [{ role: "user", content: "What do I need to fill in to create a playbook?" }],
      playbooks: [],
    },
    expected: {
      mustCall: ["describe_playbook_fields"],
      mustNotCall: [WRITE_TOOLS],
    } satisfies ToolExpectation,
    metadata: {
      note: "A question about how to create a playbook is answered from the field guide.",
    },
  },
  {
    id: "reads-handled-emails",
    input: {
      conversation: [{ role: "user", content: "Which of my emails were escalated?" }],
      playbooks: [OFFICE_HOURS],
    },
    expected: { mustCall: ["list_messages"], mustNotCall: [WRITE_TOOLS] } satisfies ToolExpectation,
    metadata: { note: "Email history is read with the message tools." },
  },
  {
    id: "small-talk-needs-no-tool",
    input: {
      conversation: [{ role: "user", content: "Thanks, that is all for now." }],
      playbooks: [OFFICE_HOURS],
    },
    expected: {
      mustNotCall: [`${WRITE_TOOLS}|list_playbooks|get_playbook|search_playbooks`],
    } satisfies ToolExpectation,
    metadata: { note: "A bad case: the agent must not call tools when nothing asks for data." },
  },
]);
