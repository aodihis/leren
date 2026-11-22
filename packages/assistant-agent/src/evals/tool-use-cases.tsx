import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";
import type { AssistantEvalOutput } from "./target";

/**
 * Which tools a run must and must not call. Each entry is a regular expression that is matched
 * against the whole tool name, so `"get_playbook|list_playbooks"` accepts either tool.
 */
export type ToolExpectation = {
  verdict: "pass" | "fail";
  mustCall?: readonly string[];
  mustNotCall?: readonly string[];
};

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  response: "We are open Monday to Friday from 09:00 to 17:00.",
});

const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  response: "Refunds are possible within 30 days of purchase.",
});

const SKILL_TOOL = ".*skill.*";

const ANSWER_FROM_MEMORY: AssistantEvalOutput = {
  text: "You have two playbooks: Office hours and Refund policy.",
  toolCalls: [],
  playbooks: [OFFICE_HOURS, REFUND],
};

const MESSY_INPUT = [
  "ok so here is everything. we ship on tuesdays and thursdays only, orders after 3pm go next slot.",
  "oh and refunds, you can get your money back within 30 days if the item is unused, ask for the receipt.",
  "also our office is open mon-fri 9 to 5, closed on public holidays. shipping to bali takes an extra 2 days.",
  "remember to tell people the refund goes back to the original payment method. my phone is not for customers.",
].join(" ");

/**
 * Cases for how the agent uses its tools. They protect the workflow of the assistant prompt: look
 * before answering, list before creating, fetch before changing, test coverage with search, and
 * load the `structure-knowledge` skill only for input that needs structuring. The metric checks
 * the tools that were called, not their order, because the prompt does not fix an order.
 */
export const toolUseCases = defineEvalCases([
  {
    id: "looks-up-playbooks-before-answering",
    input: {
      conversation: [{ role: "user", content: "Which playbooks do I have?" }],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      verdict: "pass",
      mustCall: ["list_playbooks"],
    } satisfies ToolExpectation,
    metadata: { note: "Workflow step 1: do not answer from memory about the user's data." },
  },
  {
    id: "lists-existing-playbooks-before-drafting-a-new-one",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Shipping days. Response: We ship on Tuesdays and Thursdays. Timezone: Asia/Jakarta.",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      verdict: "pass",
      mustCall: ["list_playbooks"],
      mustNotCall: ["create_playbook"],
    } satisfies ToolExpectation,
    metadata: {
      note: "Workflow step 1: call list_playbooks before creating, so there is no duplicate. No write yet, because nothing is confirmed.",
    },
  },
  {
    id: "fetches-the-playbook-before-changing-it",
    input: {
      conversation: [
        {
          role: "user",
          content: "Improve the wording of my Office hours playbook, but keep all facts.",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      verdict: "pass",
      mustCall: ["get_playbook|list_playbooks"],
      mustNotCall: ["update_playbook"],
    } satisfies ToolExpectation,
    metadata: {
      note: "Workflow step 3: fetch first. The improved text is shown for confirmation before any update.",
    },
  },
  {
    id: "tests-coverage-with-search",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Would my playbooks cover a message like 'Can I get my money back for my order?'",
        },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      verdict: "pass",
      mustCall: ["search_playbooks"],
    } satisfies ToolExpectation,
    metadata: { note: "Workflow step 4: search_playbooks shows what Leren would find for a text." },
  },
  {
    id: "loads-the-structuring-skill-for-messy-input",
    input: {
      conversation: [{ role: "user", content: `Save this knowledge for my shop: ${MESSY_INPUT}` }],
      playbooks: [],
    },
    expected: {
      verdict: "pass",
      mustCall: [SKILL_TOOL],
      mustNotCall: ["create_playbook"],
    } satisfies ToolExpectation,
    metadata: {
      note: "Workflow step 2: long, unordered input that covers several subjects needs the structure-knowledge skill, and drafts are shown before anything is saved.",
    },
  },
  {
    id: "skips-the-skill-for-clear-input",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Office parking. Response: Visitors can park at the back of the building for free. Timezone: Asia/Jakarta.",
        },
      ],
      playbooks: [],
    },
    expected: {
      verdict: "pass",
      mustNotCall: [SKILL_TOOL, "create_playbook"],
    } satisfies ToolExpectation,
    metadata: {
      note: "Workflow step 2: a clear topic and response about one subject are used as given, without the skill.",
    },
  },
  {
    id: "negative-answers-from-memory",
    input: {
      conversation: [{ role: "user", content: "Which playbooks do I have?" }],
      playbooks: [OFFICE_HOURS, REFUND],
      fixedOutput: ANSWER_FROM_MEMORY,
    },
    expected: {
      verdict: "fail",
      mustCall: ["list_playbooks"],
    } satisfies ToolExpectation,
    metadata: {
      note: "Proves that the metric detects an answer about user data without a lookup.",
    },
  },
  {
    id: "negative-uses-the-skill-for-clear-input",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Office parking. Response: Visitors can park at the back of the building for free. Timezone: Asia/Jakarta.",
        },
      ],
      playbooks: [],
      fixedOutput: {
        text: "Here is a draft.",
        toolCalls: [{ name: "load_skill", input: { name: "structure-knowledge" } }],
        playbooks: [],
      },
    },
    expected: {
      verdict: "fail",
      mustNotCall: [SKILL_TOOL, "create_playbook"],
    } satisfies ToolExpectation,
    metadata: { note: "Proves that the metric detects a forbidden tool call." },
  },
]);
