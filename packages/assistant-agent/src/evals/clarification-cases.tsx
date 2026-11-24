import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

/** A case for a rubric judge. `criteria` is what a correct answer must and must not do. */
export type RubricExpectation = { criteria: string };

const COMPLETE_REQUEST =
  "Add a playbook. Topic: Delivery times. Information: Deliveries take 2 to 3 working days. Timezone: Asia/Jakarta.";

const SHOW_AND_CONFIRM =
  "The agent shows the exact values it will save (topic, information and timezone, in the user's own words) and asks whether to go ahead. It does not ask separate questions about the instruction, a period, conditions or whether the playbook is enabled, and the shown values say that the playbook is always active and uses the default instruction.";

const ENGLISH_TOPICS = [
  playbook({
    id: "pb-hours",
    topic: "Office hours",
    information: "We are open Monday to Friday from 09:00 to 17:00.",
  }),
  playbook({
    id: "pb-refund",
    topic: "Refund policy",
    information: "Refunds are possible within 30 days of purchase.",
  }),
];

const ANSWER_ONLY_ENABLED_STATE =
  "The agent says whether the Office hours playbook is enabled, and, only if relevant, why it is not usable. It does not mention the timezone, the information text, the period or the conditions, does not mention the Refund policy playbook, and adds no suggestions, offers or next steps.";

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
            "Add a playbook. Topic: Delivery times. Information: Deliveries take 2 to 3 working days.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent tells the user that the timezone is missing and asks for it. It does not invent a timezone and does not call a tool that changes data. It may also say once that the playbook is always active unless it is limited, and ask whether to limit it, and it may say that the instruction is optional.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 2: a playbook needs a topic, information and a timezone, and the agent says what is missing.",
    },
  },
  {
    id: "does-not-ask-about-optional-settings",
    input: {
      conversation: [{ role: "user", content: COMPLETE_REQUEST }],
      playbooks: [],
    },
    expected: { criteria: SHOW_AND_CONFIRM } satisfies RubricExpectation,
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
          information: "Online orders can be refunded within 30 days.",
        }),
        playbook({
          id: "pb-refund-store",
          topic: "Refund policy for store purchases",
          information: "Store purchases can be refunded within 14 days with a receipt.",
        }),
      ],
    },
    expected: {
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
    expected: { criteria: LIST_IN_INDONESIAN } satisfies RubricExpectation,
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
      criteria: ANSWER_ONLY_ENABLED_STATE,
    } satisfies RubricExpectation,
    metadata: {
      note: "Rule: answer only what was asked, without extra information, suggestions or next steps.",
    },
  },
  {
    id: "answers-only-for-a-disabled-playbook",
    input: {
      conversation: [{ role: "user", content: "Is my Old promo playbook enabled?" }],
      playbooks: [
        playbook({
          id: "pb-promo",
          topic: "Old promo",
          information: "The old promo code gives free shipping.",
          enabled: false,
        }),
        ...ENGLISH_TOPICS,
      ],
    },
    expected: {
      criteria:
        "The agent says that the Old promo playbook is not enabled, and nothing more. It does not explain what that means, does not mention the timezone, the information text or the conditions, does not mention other playbooks, and adds no suggestions, offers or next steps, such as offering to enable it.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Rule: a yes or no answer may carry the reason that changes it, and nothing else. Offering to enable the playbook is a next step.",
    },
  },
  {
    id: "answers-a-count-without-listing",
    input: {
      conversation: [{ role: "user", content: "How many playbooks do I have?" }],
      playbooks: ENGLISH_TOPICS,
    },
    expected: {
      criteria:
        "The agent says that the user has two playbooks. It does not list the topics, information texts, timezones or states of the playbooks, and adds no suggestions, offers or next steps.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Rule: answer only what was asked. A count question does not ask for the list.",
    },
  },
  {
    id: "asks-for-the-missing-information",
    input: {
      conversation: [
        { role: "user", content: "Add a playbook. Topic: Delivery times. Timezone: Asia/Jakarta." },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent tells the user that the information is missing and asks for it. It does not invent information and does not call a tool that changes data. Suggesting what the information could contain is fine. It may say that an instruction is optional, but it does not ask about a period, senders or conditions.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 2: the agent never invents what the user did not give.",
    },
  },
]);
