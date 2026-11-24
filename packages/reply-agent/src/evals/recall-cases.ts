import { defineEvalCases } from "@anvia/core/evals";

/** A playbook of the retrieval corpus. `key` names it in the cases, because its id is generated. */
export interface CorpusPlaybook {
  key: string;
  topic: string;
  examples: string[];
  response: string;
}

/** The input of one retrieval case: the text that is searched for. */
export type RecallInput = { text: string };

/**
 * What a retrieval case expects: the keys of the playbooks that a correct search returns. An empty
 * list means that nothing in the corpus is relevant, so a correct search finds no reliable result.
 */
export type RecallExpectation = { relevant: readonly string[] };

/** The playbooks that are indexed before the retrieval cases run. All details are invented. */
export const corpus: readonly CorpusPlaybook[] = [
  {
    key: "deadline",
    topic: "Project Atlas deadline",
    examples: ["When is the Atlas deliverable due?", "What is the delivery date for Atlas?"],
    response: "The Atlas deliverable is due on Friday 28 November at 17:00 Jakarta time.",
  },
  {
    key: "scope",
    topic: "Project Atlas scope",
    examples: ["What does Atlas include?", "Is a mobile app part of Atlas?"],
    response:
      "Atlas covers the customer portal, the billing export and single sign-on. Mobile apps are out of scope.",
  },
  {
    key: "sync",
    topic: "Weekly project sync",
    examples: ["When is the weekly meeting?", "Where do we meet for the Atlas sync?"],
    response: "The Atlas sync is every Tuesday at 10:00 Jakarta time on the team call link.",
  },
  {
    key: "status",
    topic: "Project Atlas status",
    examples: ["How is Atlas going?", "Has the beta shipped?"],
    response: "Atlas is on track. The beta went to customers on 12 November.",
  },
  {
    key: "refund",
    topic: "Refund policy",
    examples: ["Can I get my money back?", "How do refunds work?"],
    response: "Refunds are possible within 30 days of purchase. Send the order number.",
  },
  {
    key: "urgent",
    topic: "Urgent matters while away",
    examples: ["Who do I call in an emergency?", "I need someone urgently"],
    response: "For anything urgent, call Devi on the number in the signature.",
  },
  {
    key: "budget",
    topic: "Project Atlas budget",
    examples: ["How much does Atlas cost?", "What is the Atlas budget?"],
    response: "Budget figures are confidential. Ask Alex in person.",
  },
  {
    key: "tasks",
    topic: "Task requests",
    examples: [
      "Can you do this task for me?",
      "Please build a new feature for me",
      "I need a report or an export made by Friday",
    ],
    response:
      "Requests for Alex to build, change or deliver something are accepted only through the board.",
  },
  {
    key: "design",
    topic: "Design requests",
    examples: ["I need a banner", "Can someone update our logo?"],
    response: "Maya handles every design request, such as banners and logos.",
  },
  {
    key: "outage",
    topic: "Production incident",
    examples: ["The site is down", "Production is broken"],
    response: "For a production outage, call the on-call engineer.",
  },
  {
    key: "office",
    topic: "Office closure",
    examples: ["Is the office open on Monday?", "When is the company retreat?"],
    response: "The office is closed on Monday 1 December for the company retreat.",
  },
];

/**
 * Retrieval cases: a paraphrase for each playbook, an email that needs two playbooks, a question
 * that shares words with a playbook but means something else, and questions that nothing in the
 * corpus answers. A case without a relevant playbook expects an abstention.
 */
export const recallCases = defineEvalCases([
  {
    id: "deadline-paraphrase",
    input: { text: "Could you tell me the date the Atlas work has to be handed in?" },
    expected: { relevant: ["deadline"] },
  },
  {
    id: "scope-paraphrase",
    input: { text: "Which features are covered by the Atlas project?" },
    expected: { relevant: ["scope"] },
  },
  {
    id: "scope-mobile",
    input: { text: "Will there be an iPhone app for Atlas?" },
    expected: { relevant: ["scope"] },
  },
  {
    id: "sync-paraphrase",
    input: { text: "What day and time is our regular Atlas catch-up?" },
    expected: { relevant: ["sync"] },
  },
  {
    id: "status-paraphrase",
    input: { text: "Are we still on schedule with Atlas, and did customers get the beta?" },
    expected: { relevant: ["status"] },
  },
  {
    id: "refund-paraphrase",
    input: { text: "I want to return what I bought last week and get reimbursed." },
    expected: { relevant: ["refund"] },
  },
  {
    id: "urgent-paraphrase",
    input: { text: "Something critical happened and I need to reach a person right now." },
    expected: { relevant: ["urgent"] },
  },
  {
    id: "budget-paraphrase",
    input: { text: "How much money has been set aside for the Atlas project?" },
    expected: { relevant: ["budget"] },
  },
  {
    id: "tasks-paraphrase",
    input: { text: "Please build a CSV export for me by the end of the week." },
    expected: { relevant: ["tasks"] },
  },
  {
    id: "design-paraphrase",
    input: { text: "We need a poster designed for the launch event." },
    expected: { relevant: ["design"] },
  },
  {
    id: "outage-paraphrase",
    input: { text: "Our customers cannot reach the website and it is a production emergency." },
    expected: { relevant: ["outage"] },
  },
  {
    id: "office-paraphrase",
    input: { text: "Will the building be open next Monday?" },
    expected: { relevant: ["office"] },
  },
  {
    id: "two-playbooks-deadline-and-scope",
    input: { text: "When is Atlas due, and does it include single sign-on?" },
    expected: { relevant: ["deadline", "scope"] },
  },
  {
    id: "two-playbooks-sync-and-status",
    input: { text: "What time is the weekly meeting, and has the beta shipped yet?" },
    expected: { relevant: ["sync", "status"] },
  },
  {
    id: "two-playbooks-refund-and-office",
    input: { text: "Can I get a refund, and is the office open on Monday to bring the order?" },
    expected: { relevant: ["refund", "office"] },
  },
  {
    id: "indonesian-deadline",
    input: { text: "Kapan batas waktu pengiriman proyek Atlas?" },
    expected: { relevant: ["deadline"] },
  },
  {
    id: "shared-words-but-other-topic",
    input: { text: "What is the deadline for submitting my tax declaration?" },
    expected: { relevant: [] },
  },
  {
    id: "unrelated-pricing",
    input: { text: "What is the price of the enterprise plan?" },
    expected: { relevant: [] },
  },
  {
    id: "unrelated-trivia",
    input: { text: "What is the capital of Australia?" },
    expected: { relevant: [] },
  },
  {
    id: "unrelated-hiring",
    input: { text: "Are you hiring a data engineer this year?" },
    expected: { relevant: [] },
  },
  {
    id: "unrelated-recipe",
    input: { text: "Do you have a good recipe for chocolate cake?" },
    expected: { relevant: [] },
  },
]);
