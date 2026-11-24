import { defineEvalCases } from "@anvia/core/evals";

/** A case for a rubric judge. `criteria` is what a correct answer must and must not do. */
export type RubricExpectation = { criteria: string };

const RAW_NOTES =
  "Here are my notes: we ship in 2 to 3 days in Java and Bali is 5 days, shipping is free above 500k, returns within 14 days if the box is sealed, and for complaints talk to Rina.";

const ASKED_FOR_KNOWLEDGE =
  "Sure. What is the information about office hours? You can also add an instruction, such as a tone or what must not be said. If you skip it, your default instruction applies.";

/**
 * Cases for how the assistant gathers the details of a new playbook (assistant prompt, step 2 of
 * the workflow). The assistant asks for the topic and the information first and tells the user that
 * the instruction is optional. It then asks once about the rules and says what an empty period
 * means. A judge grades each answer against the criteria of the case.
 */
export const intakeCases = defineEvalCases([
  {
    id: "asks-for-the-information-and-mentions-the-instruction",
    input: {
      conversation: [{ role: "user", content: "I want to add a playbook about delivery times." }],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent asks for the information about delivery times and says that an instruction is optional, for example a tone or what must not be said. It does not ask for example messages or for a response. It does not ask about start date, end date, conditions or timezone yet, and it does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: {
      note: "Stage 1: knowledge fields before the rules, so the user learns what exists.",
    },
  },
  {
    id: "explains-an-open-period-and-asks-once",
    input: {
      conversation: [
        { role: "user", content: "I want to add a playbook about office hours." },
        { role: "assistant", content: ASKED_FOR_KNOWLEDGE },
        {
          role: "user",
          content: "We are open Monday to Friday from 09:00 to 17:00. No instruction.",
        },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent says that a playbook without a start and an end is always active, and asks whether the user wants to limit it, for example to a period or to certain senders. It does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "Stage 2: the rules are offered once, with the meaning of an empty period." },
  },
  {
    id: "does-not-ask-the-rules-again-after-a-no",
    input: {
      conversation: [
        { role: "user", content: "I want to add a playbook about office hours." },
        { role: "assistant", content: ASKED_FOR_KNOWLEDGE },
        {
          role: "user",
          content: "We are open Monday to Friday from 09:00 to 17:00. No instruction.",
        },
        {
          role: "assistant",
          content:
            "A playbook without a start and an end is always active. Do you want to limit it to a period or to certain senders?",
        },
        { role: "user", content: "No, always active is fine. Timezone is Asia/Jakarta." },
      ],
      playbooks: [],
    },
    expected: {
      criteria:
        "The agent shows every value that it will save, including the topic, the information and the timezone, and asks whether to go ahead. It does not ask about the period, the senders or the instruction again, and it does not call a tool that changes data.",
    } satisfies RubricExpectation,
    metadata: { note: "A no is respected, and the flow moves to the confirmation." },
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
]);
