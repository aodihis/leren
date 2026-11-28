import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  information: "We are open Monday to Friday from 09:00 to 17:00.",
});

const HOLIDAY_SALE = playbook({
  id: "pb-sale",
  topic: "Holiday sale",
  information: "The holiday sale gives a discount on all gift items.",
  endsAt: "2026-10-31T16:59:00.000Z",
});

const OLD_PROMO = playbook({
  id: "pb-promo",
  topic: "Old promo",
  information: "The old promo code gives free shipping.",
  enabled: false,
});

const THREE_PLAYBOOKS = [OFFICE_HOURS, HOLIDAY_SALE, OLD_PROMO];

/**
 * What the agent may know besides the playbooks: the definition of a usable playbook from the
 * assistant prompt, and the fields that every playbook above has in the tool results.
 */
const COMMON_FACTS = [
  "A playbook can be used in a reply only when it is enabled and its period includes the current time.",
  "Every playbook has the timezone Asia/Jakarta and the reply conditions of the email channel, which accept any sender.",
];

/** What the playbook tools return for the three playbooks. It is the fixed truth for the judge. */
const THREE_PLAYBOOKS_CONTEXT = [
  "The user has exactly three playbooks.",
  "Playbook 'Office hours': enabled, no start and no end, period active, usable now. Information: We are open Monday to Friday from 09:00 to 17:00.",
  "Playbook 'Holiday sale': enabled, no start, ended on 31 October 2026, period expired, not usable now. Information: The holiday sale gives a discount on all gift items.",
  "Playbook 'Old promo': disabled, no start and no end, not usable now, so it is not used in replies. Information: The old promo code gives free shipping.",
  ...COMMON_FACTS,
];

const EMPTY_CONTEXT = [
  "The user has no playbooks. The list_playbooks tool returns an empty list and search_playbooks finds nothing.",
  "Playbooks are the only source of the user's policies, so the assistant has no information about any policy of the user, such as a refund policy.",
];

const HOLIDAY_PAGE = {
  id: "page-holidays",
  title: "Holiday list 2026",
  content:
    "Company holidays in 2026. 17 August 2026: Independence Day, the office is closed. 25 December 2026: Christmas Day, the office is closed. 29 December 2026: Company retreat day, the office is closed.",
};

const HOLIDAY_CONTEXT = [
  `The user's Notion page '${HOLIDAY_PAGE.title}' says: ${HOLIDAY_PAGE.content}`,
  `The page '${HOLIDAY_PAGE.title}' lists three days on which the office is closed: 17 August 2026, Independence Day. 25 December 2026, Christmas Day. 29 December 2026, Company retreat day.`,
];

/**
 * Cases for whether what the agent says about the user's data is supported by what the tools
 * returned. Faithfulness checks support and not truth, so each case carries the tool results as
 * `retrievalContext`. The group covers the saved playbooks, an empty store, a connected Notion
 * page and a processed email.
 */
export const faithfulnessCases = defineEvalCases([
  {
    id: "overview-matches-the-saved-playbooks",
    input: {
      conversation: [
        {
          role: "user",
          content: "Give me an overview of my playbooks and tell me which ones can be used.",
        },
      ],
      playbooks: THREE_PLAYBOOKS,
    },
    retrievalContext: THREE_PLAYBOOKS_CONTEXT,
    metadata: {
      note: "Good case: the answer names each topic and says which playbook is disabled or expired.",
    },
  },
  {
    id: "does-not-call-a-disabled-playbook-in-use",
    input: {
      conversation: [{ role: "user", content: "Is my Old promo playbook in use?" }],
      playbooks: THREE_PLAYBOOKS,
    },
    retrievalContext: THREE_PLAYBOOKS_CONTEXT,
    metadata: {
      note: "Bad case: a disabled playbook is not in use, and the answer must not claim that it is.",
    },
  },
  {
    id: "does-not-invent-what-the-playbook-omits",
    input: {
      conversation: [
        {
          role: "user",
          content: "Does my Holiday sale playbook say anything about free delivery?",
        },
      ],
      playbooks: THREE_PLAYBOOKS,
    },
    retrievalContext: [
      ...THREE_PLAYBOOKS_CONTEXT,
      "The Holiday sale playbook does not mention delivery.",
    ],
    metadata: {
      note: "Bad case: the playbook does not mention delivery, and the answer must not claim that it does.",
    },
  },
  {
    id: "reports-that-nothing-matches",
    input: {
      conversation: [{ role: "user", content: "What do my playbooks say about shipping costs?" }],
      playbooks: [OFFICE_HOURS],
    },
    retrievalContext: [
      "The user has exactly one playbook.",
      "Playbook 'Office hours': enabled, no start and no end, period active, usable now. Information: We are open Monday to Friday from 09:00 to 17:00.",
      "The search_playbooks tool finds no reliable match for shipping costs, because no playbook mentions shipping.",
      ...COMMON_FACTS,
    ],
    metadata: {
      note: "Bad case: no playbook covers shipping, and the answer must not fill the gap with a guess.",
    },
  },
  {
    id: "empty-store-lists-nothing",
    input: {
      conversation: [{ role: "user", content: "Show me the list of my playbooks." }],
      playbooks: [],
    },
    retrievalContext: EMPTY_CONTEXT,
    metadata: { note: "Good case: the user has no playbooks, so the answer names none." },
  },
  {
    id: "empty-store-has-no-refund-policy",
    input: {
      conversation: [{ role: "user", content: "What does my refund policy say?" }],
      playbooks: [],
    },
    retrievalContext: EMPTY_CONTEXT,
    metadata: {
      note: "Bad case: a refund policy is easy to invent. The store is empty, so the answer must state no policy.",
    },
  },
  {
    id: "reads-the-notion-page-as-written",
    input: {
      conversation: [{ role: "user", content: "What is on my Holiday list 2026 page in Notion?" }],
      playbooks: [],
      notion: [HOLIDAY_PAGE],
    },
    retrievalContext: HOLIDAY_CONTEXT,
    metadata: {
      note: "Good case: the answer reports the dates and the reasons as the page gives them.",
    },
  },
  {
    id: "notion-page-does-not-hold-the-asked-fact",
    input: {
      conversation: [
        {
          role: "user",
          content: "Does my Holiday list 2026 page in Notion say who covers the phones?",
        },
      ],
      playbooks: [],
      notion: [HOLIDAY_PAGE],
    },
    retrievalContext: [...HOLIDAY_CONTEXT, "The page says nothing about who covers the phones."],
    metadata: {
      note: "Bad case: the page holds no information on phone cover, and the answer must not name anyone.",
    },
  },
  {
    id: "explains-an-escalated-email-from-its-record",
    input: {
      conversation: [
        { role: "user", content: "Why was the email from client@example.com not answered?" },
      ],
      playbooks: [OFFICE_HOURS],
    },
    retrievalContext: [
      "The email from client@example.com has the status escalated. The reason in the record is: No playbook covers refunds.",
      "The email asked for money back for order 123. No reply was written for it.",
      "The record has the subject 'Refund for order 123' and the link https://app.example.com/emails/msg-1.",
    ],
    metadata: {
      note: "Good case: the answer gives the reason from the record and does not guess another cause.",
    },
  },
]);
