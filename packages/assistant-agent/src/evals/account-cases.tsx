import { defineEvalCases } from "@anvia/core/evals";
import type { RubricExpectation } from "./scope-cases";

const OFFICE_HOURS_REQUEST =
  "Create a playbook with the topic Office hours. The response is: We are open Monday to Friday from 09:00 to 17:00. The timezone is Asia/Jakarta.";

const CONFIRMED_CONVERSATION = [
  { role: "user", content: OFFICE_HOURS_REQUEST },
  {
    role: "assistant",
    content:
      "I will save a playbook with the topic Office hours, the response 'We are open Monday to Friday from 09:00 to 17:00.' and the timezone Asia/Jakarta. It will be enabled. Shall I go ahead?",
  },
  { role: "user", content: "Yes, go ahead." },
] as const;

/**
 * Cases for the mailbox of a playbook (decision 0044): a playbook that is on must name a connected
 * email account. The fake `create_playbook` tool behaves like the real one: it uses the only account
 * that the user has, and it fails with a message that says what to do when the user has none or has
 * several. A judge grades each answer against the criteria of the case.
 */
export const accountCases = defineEvalCases([
  {
    id: "one-account-is-used-without-asking",
    input: {
      conversation: CONFIRMED_CONVERSATION,
      playbooks: [],
      accounts: [{ id: "acct-main", label: "me@example.com" }],
    },
    expected: {
      criteria:
        "The agent calls create_playbook and tells the user that the playbook was saved. It does not ask the user which email account to use, and it does not ask about accounts at all.",
    } satisfies RubricExpectation,
  },
  {
    id: "several-accounts-asks-which-one",
    input: {
      conversation: CONFIRMED_CONVERSATION,
      playbooks: [],
      accounts: [
        { id: "acct-work", label: "work@example.com" },
        { id: "acct-home", label: "home@example.com" },
      ],
    },
    expected: {
      criteria:
        "The tool fails because the user has several email accounts. The agent asks the user which account the playbook answers on and names the choices work@example.com and home@example.com. It does not say that the playbook was saved, and it does not pick an account by itself.",
    } satisfies RubricExpectation,
  },
  {
    id: "no-account-says-to-connect-one",
    input: {
      conversation: CONFIRMED_CONVERSATION,
      playbooks: [],
      accounts: [],
    },
    expected: {
      criteria:
        "The tool fails because the user has no connected email account. The agent tells the user to connect an email account on the Channels page. It does not say that the playbook was saved. It may offer to save the playbook as disabled until an account is connected.",
    } satisfies RubricExpectation,
  },
]);
