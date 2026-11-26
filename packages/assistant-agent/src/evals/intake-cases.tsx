import { defineEvalCases } from "@anvia/core/evals";
import { playbook } from "./target";

/** A case for a rubric judge. `criteria` is what a correct answer must and must not do. */
export type RubricExpectation = { criteria: string };

const RAW_NOTES =
  "Here are my notes: we ship in 2 to 3 days in Java and Bali is 5 days, shipping is free above 500k, returns within 14 days if the box is sealed, and for complaints talk to Rina.";

/**
 * Cases for how the assistant gathers the details of a new playbook (assistant prompt, step 2 of
 * the workflow). The assistant asks only for the required fields that are still missing, as a
 * bulleted list with one bullet for each, and never asks about the fields that have a default. It
 * then shows the confirmation with the defaults that apply. A judge grades each answer against the
 * criteria of the case.
 */
export const intakeCases = defineEvalCases([
  {
    id: "asks-for-each-missing-required-field-as-a-bullet",
    input: {
      conversation: [{ role: "user", content: "I want to add a playbook about delivery times." }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent asks for what is still missing, which is the information about delivery times and the timezone, as a bulleted list with one bullet for each missing field. It does not ask about an instruction, a period, senders or conditions, it does not ask for example messages or for a response, and it does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Missing required fields are a bulleted list. Fields with a default are not asked.",
    },
  },
  {
    id: "asks-one-short-sentence-for-a-single-missing-field",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Office hours. Information: We are open Monday to Friday from 09:00 to 17:00.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent asks only for the timezone, in one short sentence. It does not use a bulleted list, does not ask about an instruction, a period or senders, and does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "One missing field is one short question." },
  },
  {
    id: "goes-to-the-confirmation-with-the-defaults-after-the-last-answer",
    input: {
      conversation: [
        { role: "user", content: "I want to add a playbook about office hours." },
        {
          role: "assistant",
          content:
            "- Information: what should I say about office hours?\n- Timezone, such as Asia/Jakarta",
        },
        {
          role: "user",
          content: "We are open Monday to Friday from 09:00 to 17:00. Timezone is Asia/Jakarta.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent shows every value that it will save, including the topic, the information and the timezone, says in one line that the playbook is always active and uses the default instruction, and asks whether to go ahead. It does not ask about a period, senders or an instruction, and it does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "No second interview: the defaults are shown in the confirmation instead." },
  },
  {
    id: "offers-to-refine-raw-notes",
    input: {
      conversation: [{ role: "user", content: RAW_NOTES }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent treats the text as raw notes that cover more than one subject. It offers or shows a refined split into separate playbooks with a topic and information each, and asks the user for feedback before anything is saved. It does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Raw input goes through the structure-knowledge skill and the user reviews it.",
    },
  },
  {
    id: "complete-request-goes-to-the-confirmation",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Please add a playbook. Topic: Office hours. Information: We are open Monday to Friday from 09:00 to 17:00. Timezone: Asia/Jakarta.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent shows every value that it will save, says that the playbook is always active and uses the default instruction, and asks whether to go ahead. It does not ask separate questions about details that the user already gave, and it does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Nothing is asked twice, and the confirmation still shows the fields that were left at their defaults.",
    },
  },
  {
    id: "answers-only-that-a-playbook-does-not-exist",
    input: {
      conversation: [{ role: "user", content: "Do I have a playbook called Parking?" }],
      playbooks: [
        playbook({
          id: "pb-hours",
          topic: "Office hours",
          information: "We are open Monday to Friday from 09:00 to 17:00.",
        }),
      ],
    },
    expected: {
      criteria:
        "The agent says that there is no playbook called Parking, in one short sentence. It does not offer to create one, does not explain how to create one, does not list the playbooks that exist and does not ask a question.",
    } satisfies RubricExpectation,
    metadata: { note: "Rules: answer only what was asked, even when the answer is no." },
  },
  {
    id: "lists-every-field-when-asked-how-to-create",
    input: {
      conversation: [
        { role: "user", content: "How do I create a playbook? Which fields do I need?" },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent lists the fields of a playbook as bullets, with the topic, the information and the timezone marked as required and the others marked as optional with their defaults. Each bullet says briefly what the field means. It does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Workflow step 8: a how-to question gets the full field list from the tool.",
    },
  },
  {
    id: "introduces-the-product-in-three-steps",
    input: {
      conversation: [{ role: "user", content: "Hi, what can you do? How do I get started?" }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent says in one sentence what the product does, which is answering incoming email from playbooks. It then gives about three short numbered steps: connect a mailbox, add a playbook, and review the drafted replies. It mentions that a playbook can be added in the chat, on the Playbooks page or with a coding agent. It stays short, and it does not list the fields of a playbook or ask a question.",
    } satisfies RubricExpectation,
    metadata: { note: "Onboarding: a minimal introduction with the steps." },
  },
  {
    id: "links-the-saved-playbook-in-one-line",
    input: {
      conversation: [
        {
          role: "user",
          content:
            "Add a playbook. Topic: Office parking. Information: Visitors can park at the back for free. Timezone: Asia/Jakarta.",
        },
        {
          role: "assistant",
          content:
            "Topic: Office parking\nInformation: Visitors can park at the back for free.\nTimezone: Asia/Jakarta\n\nIt is always active, answers any sender and uses the default instruction. Save it?",
        },
        { role: "user", content: "Yes, save it." },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent confirms the save in one short line that shows the topic Office parking as a Markdown link to a URL that contains /playbooks/, and says that the playbook is enabled. It does not repeat the saved values.",
    } satisfies RubricExpectation,
    metadata: { note: "Workflow step 6: the confirmation of a save carries the link." },
  },
]);
