import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  response: "We are open Monday to Friday from 09:00 to 17:00.",
});

const HOLIDAY_SALE = playbook({
  id: "pb-sale",
  topic: "Holiday sale",
  response: "The holiday sale gives a discount on all gift items.",
  endsAt: "2026-10-31T16:59:00.000Z",
});

const OLD_PROMO = playbook({
  id: "pb-promo",
  topic: "Old promo",
  response: "The old promo code gives free shipping.",
  enabled: false,
});

const THREE_PLAYBOOKS = [OFFICE_HOURS, HOLIDAY_SALE, OLD_PROMO];

/**
 * What the agent may know besides the playbooks: the definition of a usable playbook from the
 * assistant prompt, and the fields that every playbook above has in the tool results.
 */
const COMMON_FACTS = [
  "Leren can use a playbook in a reply only when it is enabled and its period includes the current time.",
  "Every playbook has the timezone Asia/Jakarta and the reply conditions of the email channel, which accept any sender.",
];

/** What the playbook tools return for the playbooks above. It is the fixed truth for the judge. */
const THREE_PLAYBOOKS_CONTEXT = [
  "The user has exactly three playbooks.",
  "Playbook 'Office hours': enabled, no start and no end, period active, usable now. Response: We are open Monday to Friday from 09:00 to 17:00.",
  "Playbook 'Holiday sale': enabled, no start, ended on 31 October 2026, period expired, not usable now. Response: The holiday sale gives a discount on all gift items.",
  "Playbook 'Old promo': disabled, no start and no end, not usable now. Response: The old promo code gives free shipping.",
  ...COMMON_FACTS,
];

/**
 * Cases for whether what the agent says about the user's data is supported by the tool results.
 * The prompt forbids inventing facts, prices, dates or policies, and requires that disabled and
 * expired playbooks are named as such. Faithfulness checks support and not truth, so each case
 * carries the tool results as `retrievalContext`.
 */
export const faithfulnessCases = defineEvalCases([
  {
    id: "overview-matches-the-saved-playbooks",
    input: {
      conversation: [
        {
          role: "user",
          content: "Give me an overview of my playbooks and tell me which ones Leren can use.",
        },
      ],
      playbooks: THREE_PLAYBOOKS,
    },
    retrievalContext: THREE_PLAYBOOKS_CONTEXT,
    metadata: {
      note: "The answer must name each topic and say which playbook is disabled or expired, using only what the tools returned.",
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
      "Playbook 'Office hours': enabled, no start and no end, period active, usable now. Response: We are open Monday to Friday from 09:00 to 17:00.",
      "The search_playbooks tool finds no reliable match for shipping costs, because no playbook mentions shipping.",
      ...COMMON_FACTS,
    ],
    metadata: {
      note: "The prompt says to state plainly that nothing relevant was found, and not to fill the gap with a guess.",
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
      note: "A disabled playbook is not in use. The answer must follow the tool result and not the wording of the question.",
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
      note: "The prompt forbids inventing facts. The answer must say that the playbook does not mention delivery.",
    },
  },
]);
