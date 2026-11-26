import { defineEvalCases } from "@anvia/core/evals";
import type { JudgeExpectation } from "./judge";
import { playbook } from "./target";

const NO_WRITE = { mustNotCall: ["create_playbook|update_playbook"] };

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

const HOLIDAY_PAGES = [
  {
    id: "page-2025",
    title: "Holiday list 2025",
    content: "Company holidays in 2025. 25 December 2025: Christmas Day, the office is closed.",
  },
  {
    id: "page-2026",
    title: "Holiday list 2026",
    content: "Company holidays in 2026. 25 December 2026: Christmas Day, the office is closed.",
  },
];

/**
 * Cases for how the agent asks. The prompt says to ask when a request, a fact or a choice is unclear
 * or a required field is missing, never to guess, and never to ask about optional settings. Each
 * case is graded by a judge against criteria, and by a deterministic check that nothing was saved
 * while the question was open: no write call, or, where a failed write is allowed, an empty store
 * afterwards.
 */
export const clarificationCases = defineEvalCases([
  {
    id: "asks-what-a-vague-want-means",
    input: { conversation: [{ role: "user", content: "I want" }], playbooks: [] },
    expected: {
      criteria:
        "The message is unfinished and does not say what the user wants. The agent asks what the user wants, in one short question, and does not act on a guessed request. It may name a few things that it can help with as examples. It does not create anything and does not explain playbooks at length.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: { note: "Bad case: a fragment that gives nothing to act on." },
  },
  {
    id: "asks-what-a-vague-change-refers-to",
    input: {
      conversation: [{ role: "user", content: "Change it." }],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      criteria:
        "The agent says that it does not know what to change and asks which playbook and what the change is. It does not pick a playbook and does not call a tool that changes data.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: {
      note: "Bad case: the pronoun refers to nothing, and two playbooks could be meant.",
    },
  },
  {
    id: "asks-for-everything-when-only-an-intent-is-given",
    input: {
      conversation: [{ role: "user", content: "I want to add a playbook." }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent asks for the three things that a playbook needs and the user has not given: the topic, the information and the timezone. It asks in one message, in a short list or a short question. It does not ask about the instruction, a period, senders or whether the playbook is enabled, and it does not create anything.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: { note: "Good case: the user states an intent without any value." },
  },
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
        "The agent tells the user that the timezone is missing and asks for it. It does not invent a timezone and does not call a tool that changes data. It does not ask again for the topic or the information.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: {
      note: "Good case: only the timezone is missing, and the other values must not be asked again.",
    },
  },
  {
    id: "does-not-ask-about-optional-settings",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Delivery times. Information: Deliveries take 2 to 3 working days. Timezone: Asia/Jakarta.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent shows the values it will save, the topic, the information and the timezone, and asks whether to go ahead. It does not ask about the instruction, a period, senders, conditions or whether the playbook is enabled.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: { note: "Bad case: the agent is tempted to ask about settings that have a default." },
  },
  {
    id: "asks-which-account-when-there-are-several",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Parking. Information: Visitors park in the basement. Timezone: Asia/Jakarta. Yes, save it.",
        },
      ],
      playbooks: [],
      accounts: [
        { id: "acct-main", label: "me@example.com" },
        { id: "acct-sales", label: "sales@example.com" },
      ],
    },
    expected: {
      criteria:
        "The user has two connected email accounts, me@example.com and sales@example.com. The agent asks which account the playbook answers on and names both accounts. It does not choose one for the user and does not claim that the playbook was saved.",
      playbooksAfter: 0,
    } satisfies JudgeExpectation,
    metadata: {
      note: "Bad case: the user said yes, but the account is still open. A first write may fail without an account, so the check is that the store is still empty afterwards, which also catches a retry with a guessed account.",
    },
  },
  {
    id: "asks-which-playbook-to-update",
    input: {
      conversation: [
        { role: "user", content: "Update my playbook to say that we close at 18:00." },
      ],
      playbooks: [OFFICE_HOURS, REFUND],
    },
    expected: {
      criteria:
        "The user has two playbooks, Office hours and Refund policy. The agent either names Office hours as the one that this fits and asks the user to confirm the change, or asks which playbook is meant. It does not call a tool that changes data before the user confirms.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: {
      note: "Bad case: the target playbook is not named, and nothing may be saved unconfirmed.",
    },
  },
  {
    id: "asks-which-notion-page-to-use",
    input: {
      conversation: [{ role: "user", content: "Turn my Notion holiday list into a playbook." }],
      playbooks: [],
      notion: HOLIDAY_PAGES,
    },
    expected: {
      criteria:
        "Two Notion pages fit: Holiday list 2025 and Holiday list 2026. The agent lists both and asks which one to use. It does not pick one for the user and does not create a playbook.",
      tools: { mustCall: ["notionnotion-search"], ...NO_WRITE },
    } satisfies JudgeExpectation,
    metadata: {
      note: "Bad case: connector-to-playbook says to list several results and ask, not to pick.",
    },
  },
  {
    id: "asks-about-a-contradiction-in-the-notes",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Please add this as a playbook, timezone Asia/Jakarta. Our shop opens at 09:00 on weekdays. Later in the notes: on weekdays the shop opens at 08:00. Closed on Sundays.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The notes give two different opening times on weekdays, 09:00 and 08:00. The agent points out the conflict and asks which time is right. It does not choose one and does not call a tool that changes data.",
      tools: NO_WRITE,
    } satisfies JudgeExpectation,
    metadata: {
      note: "Bad case: structure-knowledge says to ask when two statements contradict each other.",
    },
  },
]);
