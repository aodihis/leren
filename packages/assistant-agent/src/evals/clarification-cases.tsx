import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

/** A case for a rubric judge. `criteria` is what a correct answer must and must not do. */
export type RubricExpectation = { verdict: "pass" | "fail"; criteria: string };

const COMPLETE_REQUEST =
  "Add a playbook. Topic: Delivery times. Response: Deliveries take 2 to 3 working days. Timezone: Asia/Jakarta.";

const SHOW_AND_CONFIRM =
  "The agent shows the exact values it will save (topic, response and timezone, in the user's own words) and asks whether to go ahead. It does not ask about examples, restrictions, contacts, a period, conditions or whether the playbook is enabled.";

const ENGLISH_TOPICS = [
  playbook({
    id: "pb-hours",
    topic: "Office hours",
    response: "We are open Monday to Friday from 09:00 to 17:00.",
  }),
  playbook({
    id: "pb-refund",
    topic: "Refund policy",
    response: "Refunds are possible within 30 days of purchase.",
  }),
];

const LIST_IN_INDONESIAN =
  "The answer is written in Indonesian, the language of the user, and names the topics Office hours and Refund policy.";

/**
 * Cases for how the agent asks. The prompt says to ask when something is unclear or required and
 * missing, never to ask about optional settings that the user did not mention, and to answer in
 * the user's language. A judge grades each answer against the criteria of the case.
 */
export const clarificationCases = defineEvalCases([
  {
    id: "asks-for-the-missing-timezone",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Delivery times. Response: Deliveries take 2 to 3 working days.",
        },
      ],
      playbooks: [],
    },
    expected: {
      verdict: "pass",
      criteria:
        "The agent tells the user that the timezone is missing and asks for it. It does not invent a timezone and does not call a tool that changes data. It does not ask about examples, restrictions, contacts, a period or conditions.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 2: a playbook needs a topic, a response and a timezone, and the agent says what is missing.",
    },
  },
  {
    id: "does-not-ask-about-optional-settings",
    input: {
      conversation: [{ role: "user", content: COMPLETE_REQUEST }],
      playbooks: [],
    },
    expected: { verdict: "pass", criteria: SHOW_AND_CONFIRM } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 2: optional settings have defaults, so the agent does not ask about options the user did not mention.",
    },
  },
  {
    id: "asks-which-playbook-when-the-request-is-ambiguous",
    input: {
      conversation: [
        { role: "user", content: "Update the refund playbook: refunds now take 7 days." },
      ],
      playbooks: [
        playbook({
          id: "pb-refund-online",
          topic: "Refund policy for online orders",
          response: "Online orders can be refunded within 30 days.",
        }),
        playbook({
          id: "pb-refund-store",
          topic: "Refund policy for store purchases",
          response: "Store purchases can be refunded within 14 days with a receipt.",
        }),
      ],
    },
    expected: {
      verdict: "pass",
      criteria:
        "The agent names the two refund playbooks and asks the user which one to change. It does not pick one by itself and does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "Rule: do not guess what the user means. Ask, and wait for the answer." },
  },
  {
    id: "answers-in-the-users-language",
    input: {
      conversation: [{ role: "user", content: "Tolong tampilkan semua playbook saya." }],
      playbooks: ENGLISH_TOPICS,
    },
    expected: { verdict: "pass", criteria: LIST_IN_INDONESIAN } satisfies RubricExpectation,
    metadata: {
      note: "Style: answer in the language of the user, even when the saved topics are in English.",
    },
  },
  {
    id: "answers-only-what-was-asked",
    input: {
      conversation: [{ role: "user", content: "Is my Office hours playbook enabled?" }],
      playbooks: ENGLISH_TOPICS,
    },
    expected: {
      verdict: "pass",
      criteria:
        "The agent says whether the Office hours playbook is enabled. It adds no suggestions, offers, next steps or unrelated information, and does not mention the Refund policy playbook.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Rule: answer only what was asked, without extra information, suggestions or next steps.",
    },
  },
  {
    id: "negative-asks-about-optional-settings",
    input: {
      conversation: [{ role: "user", content: COMPLETE_REQUEST }],
      playbooks: [],
      fixedOutput: {
        text: "Great! Before I save it, would you like to add example messages, restrictions, contacts, a start and end date, or reply conditions? And should it be enabled right away?",
        toolCalls: [],
        playbooks: [],
      },
    },
    expected: { verdict: "fail", criteria: SHOW_AND_CONFIRM } satisfies RubricExpectation,
    metadata: {
      note: "Proves that the judge detects questions about options the user did not mention.",
    },
  },
  {
    id: "negative-answers-in-the-wrong-language",
    input: {
      conversation: [{ role: "user", content: "Tolong tampilkan semua playbook saya." }],
      playbooks: ENGLISH_TOPICS,
      fixedOutput: {
        text: "You have two playbooks: Office hours and Refund policy. Both are enabled.",
        toolCalls: [{ name: "list_playbooks", input: {} }],
        playbooks: ENGLISH_TOPICS,
      },
    },
    expected: { verdict: "fail", criteria: LIST_IN_INDONESIAN } satisfies RubricExpectation,
    metadata: {
      note: "Proves that the judge detects an answer in a different language than the user's.",
    },
  },
]);
