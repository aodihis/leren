import { defineEvalCases } from "@anvia/core/evals";
import type { JudgeExpectation } from "./judge";
import { playbook } from "./target";

const NO_WRITE = { mustNotCall: ["create_playbook|update_playbook"] };
const SKILL = ".*skill.*";

const OFFICE_HOURS = playbook({
  id: "pb-hours",
  topic: "Office hours",
  information: "We are open Monday to Friday from 09:00 to 17:00.",
});

const HOLIDAY_PAGE = {
  id: "page-holidays",
  title: "Holiday list 2026",
  content:
    "Company holidays in 2026. 17 August 2026: Independence Day, the office is closed. 29 December 2026: Company retreat day, the office is closed.",
};

const REFUND_PAGE = {
  id: "page-refund",
  title: "Refund process",
  content:
    "Customers can ask for a refund within 14 days of delivery. The item must be unused. Refunds are paid to the original payment method within 5 working days. Contact finance@example.com for refunds above 500 USD.",
};

/**
 * Notes of a shop owner that cover four subjects in no order, with one fact for each subject that
 * is easy to drop or to change: the Saturday hours, the refund limit, the free shipping minimum
 * and the person to contact about parking.
 */
const LONG_NOTES = `Please turn these notes into playbooks. Timezone Asia/Jakarta for all of them.

We ship from Jakarta every Tuesday and Thursday, and orders above 300000 rupiah get free shipping. Parking is only in the basement, 20 spots, and the guard Pak Budi (0812-555-0101) opens the gate. Refunds are possible within 14 days if the item is unused, and the money goes back to the same payment method. We are open Monday to Friday 09:00 to 17:00 and on Saturday 09:00 to 13:00, closed on Sunday. Oh, and shipping to other islands takes 5 to 7 days. For refunds over 500000 rupiah ask Ibu Sari first (sari@example.com).`;

/**
 * Cases for whether the agent gets the content and the arguments right. A judge compares the answer
 * with a known correct reference, and deterministic checks cover the tool calls, the loaded skills
 * and the arguments of the one write.
 */
export const correctnessCases = defineEvalCases([
  {
    id: "notion-page-becomes-a-one-day-draft",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Use my Notion page Holiday list 2026 and make a playbook for the company retreat day. Timezone Asia/Jakarta.",
        },
      ],
      playbooks: [],
      notion: [HOLIDAY_PAGE],
    },
    expected: {
      criteria:
        "The agent shows a draft for the company retreat day and asks the user to confirm before saving. It does not say that the playbook is saved.",
      reference:
        "A draft with a topic about the company retreat day on 29 December 2026. The information says that the office is closed on 29 December 2026 for the company retreat. The period is the single day 29 December 2026 in Asia/Jakarta. The answer says, in the draft or in a sentence before it, that the content came from the Notion page. It names the defaults that apply and asks whether to go ahead. The draft itself does not include the other holidays on the page, and a remark outside the draft that the page has other entries is fine.",
      tools: {
        mustCall: ["notionnotion-search|notionnotion-fetch", SKILL],
        ...NO_WRITE,
      },
    } satisfies JudgeExpectation,
    metadata: {
      note: "Workflow step 5 and the connector-to-playbook skill: read the page, load the skill, show a one-day draft and ask.",
    },
  },
  {
    id: "notion-page-answer-matches-the-page",
    input: {
      conversation: [
        {
          role: "user",
          content: "What does my Refund process page in Notion say about the time limit?",
        },
      ],
      playbooks: [],
      notion: [REFUND_PAGE],
    },
    expected: {
      criteria:
        "The answer gives the time limit that the page states. It does not paste the whole page, does not repeat the payment or the contact details, and does not invent a number.",
      reference: "Refunds can be asked for within 14 days of delivery.",
      tools: { mustCall: ["notionnotion-search|notionnotion-fetch"], ...NO_WRITE },
    } satisfies JudgeExpectation,
    metadata: { note: "The agent reads through the connector and answers only what was asked." },
  },
  {
    id: "long-notes-become-separate-drafts-with-every-fact",
    input: {
      conversation: [{ role: "user", content: LONG_NOTES }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent shows separate drafts, one for each subject, and ends by asking the user for an answer, in whatever wording. It does not say that anything is saved. Every fact of the reference sits under the right subject, no fact about the subjects is invented, and no number is changed. A line that names the defaults of the drafts, such as always active, any sender, the default instruction or enabled, is allowed and is not an invented fact. It does not matter whether such a line is present.",
      reference:
        "Four drafts. Shipping: ships from Jakarta every Tuesday and Thursday, orders above 300000 rupiah get free shipping, and shipping to other islands takes 5 to 7 days. Parking: only in the basement with 20 spots, and the guard Pak Budi (0812-555-0101) opens the gate. Refunds: possible within 14 days if the item is unused, the money goes back to the same payment method, and refunds over 500000 rupiah need Ibu Sari first (sari@example.com). Opening hours: Monday to Friday 09:00 to 17:00, Saturday 09:00 to 13:00, closed on Sunday. The timezone of every draft is Asia/Jakarta.",
      tools: { mustCall: [SKILL], ...NO_WRITE },
    } satisfies JudgeExpectation,
    metadata: {
      note: "Workflow step 2: long, unordered input goes through structure-knowledge. A fact that is far from its subject, such as the island shipping time, must land under that subject.",
    },
  },
  {
    id: "clear-input-skips-the-skill-and-keeps-the-words",
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
        "The agent shows the topic, the information and the timezone with the user's own words, and asks whether to go ahead.",
      reference:
        "Topic: Delivery times. Information: Deliveries take 2 to 3 working days. Timezone: Asia/Jakarta. The playbook is always active, answers any sender and uses the default instruction.",
      tools: { mustNotCall: [SKILL, "create_playbook|update_playbook"] },
    } satisfies JudgeExpectation,
    metadata: {
      note: "Workflow step 2: a clear single topic is used as the user wrote it, without the skill.",
    },
  },
  {
    id: "confirmed-create-saves-the-confirmed-values",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Delivery times. Information: Deliveries take 2 to 3 working days. Timezone: Asia/Jakarta.",
        },
        {
          role: "assistant",
          content:
            "I will save this playbook.\n\nTopic: Delivery times\nInformation: Deliveries take 2 to 3 working days.\nTimezone: Asia/Jakarta\n\nIt is always active, answers any sender and uses the default instruction. Shall I go ahead?",
        },
        { role: "user", content: "Yes, go ahead." },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent confirms the save in one line that names the topic Delivery times, with a link when the tool returned one, and says that it is enabled. It does not repeat the saved values.",
      write: {
        tool: "create_playbook",
        includes: {
          topic: "Delivery times",
          information: "Deliveries take 2 to 3 working days.",
          timezone: "Asia/Jakarta",
        },
        omits: ["instruction", "startsAt", "endsAt"],
      },
    } satisfies JudgeExpectation,
    metadata: {
      note: "Workflow steps 5 and 6: write exactly what was confirmed, then answer in one line.",
    },
  },
  {
    id: "confirmed-update-names-only-the-changed-field",
    input: {
      conversation: [
        { role: "user", content: "Change the Office hours playbook so that we close at 18:00." },
        {
          role: "assistant",
          content:
            "Playbook: [Office hours](https://app.example.com/playbooks/pb-hours)\nInformation, now: We are open Monday to Friday from 09:00 to 17:00.\nInformation, new: We are open Monday to Friday from 09:00 to 18:00.\n\nShall I go ahead?",
        },
        { role: "user", content: "Yes." },
      ],
      playbooks: [OFFICE_HOURS],
    },
    expected: {
      criteria:
        "The agent confirms the change in one short line, with a link, and does not repeat the values.",
      write: {
        tool: "update_playbook",
        includes: {
          playbookId: "pb-hours",
          information: "We are open Monday to Friday from 09:00 to 18:00.",
        },
        omits: ["topic", "timezone", "enabled", "startsAt", "endsAt"],
      },
    } satisfies JudgeExpectation,
    metadata: { note: "Workflow step 3: name only the fields to change when you update." },
  },
  {
    id: "confirmed-update-looks-up-the-playbook-id",
    input: {
      conversation: [
        { role: "user", content: "Change the Office hours playbook so that we close at 18:00." },
        {
          role: "assistant",
          content:
            "Information, now: We are open Monday to Friday from 09:00 to 17:00.\nInformation, new: We are open Monday to Friday from 09:00 to 18:00.\n\nShall I go ahead?",
        },
        { role: "user", content: "Yes." },
      ],
      playbooks: [OFFICE_HOURS],
    },
    expected: {
      criteria: "The agent confirms the change in one short line and does not repeat the values.",
      tools: { mustCall: ["list_playbooks|get_playbook"] },
      write: {
        tool: "update_playbook",
        includes: {
          playbookId: "pb-hours",
          information: "We are open Monday to Friday from 09:00 to 18:00.",
        },
        omits: ["topic", "timezone", "enabled"],
      },
    } satisfies JudgeExpectation,
    metadata: {
      note: "The conversation holds no id. The agent must read the id from a tool, and a guessed id shows as a second write call.",
    },
  },
  {
    id: "confirmed-single-date-saves-a-one-day-period",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Company retreat day. Information: The office is closed on 29 December 2026 for the company retreat. Timezone: Asia/Jakarta. It only applies on that day.",
        },
        {
          role: "assistant",
          content:
            "I will save this playbook.\n\nTopic: Company retreat day\nInformation: The office is closed on 29 December 2026 for the company retreat.\nTimezone: Asia/Jakarta\nPeriod: the single day 29 December 2026, from 00:00 to 23:59:59.\n\nShall I go ahead?",
        },
        { role: "user", content: "Yes, save it." },
      ],
      playbooks: [],
    },
    expected: {
      criteria: "The agent confirms the save in one line that names the topic Company retreat day.",
      write: {
        tool: "create_playbook",
        includes: {
          topic: "Company retreat day",
          timezone: "Asia/Jakarta",
        },
        instants: {
          startsAt: ["2026-12-28T16:59:00.000Z", "2026-12-28T17:01:00.000Z"],
          endsAt: ["2026-12-29T16:58:00.000Z", "2026-12-29T17:00:00.000Z"],
        },
      },
    } satisfies JudgeExpectation,
    metadata: {
      note: "A date in the Asia/Jakarta timezone starts at 17:00 UTC of the day before and ends at 16:59:59 UTC of that day. The check allows a minute of slack.",
    },
  },
]);
