import type { Playbook } from "../../pipeline/playbooks";

/** Builds a playbook fixture. An instruction that is not given is empty. */
function playbook(fields: Pick<Playbook, "id" | "topic" | "information"> & Partial<Playbook>) {
  return { instruction: "", ...fields } satisfies Playbook;
}

/** The playbooks that the drafter evals use. All of the people and details are invented. */
export const DEADLINE = playbook({
  id: "pb-deadline",
  topic: "Project Atlas deadline",
  information: "The Atlas deliverable is due on Friday 28 November at 17:00 Jakarta time.",
});

export const DEADLINE_FIXED = playbook({
  id: "pb-deadline-fixed",
  topic: "Project Atlas deadline changes",
  information: "The Atlas deadline of Friday 28 November is fixed and cannot be changed.",
});

export const DEADLINE_BUDI = playbook({
  id: "pb-deadline-budi",
  topic: "Atlas deadline for Budi",
  information: "The Atlas deliverable for Budi's team is due on Friday 28 November at 17:00.",
});

export const DEADLINE_SAM = playbook({
  id: "pb-deadline-sam",
  topic: "Atlas deadline for Sam",
  information: "The Atlas deliverable for Sam's team is due on Friday 5 December at 17:00.",
});

export const SYNC = playbook({
  id: "pb-sync",
  topic: "Weekly project sync",
  information:
    "The Atlas sync is every Tuesday at 10:00 Jakarta time at https://meet.example.com/atlas-sync.",
});

export const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  information:
    "Refunds are possible only within 30 days of purchase. The sender must send the order number with the refund request.",
  instruction: "Never promise a refund after 30 days.",
});

export const VACATION = playbook({
  id: "pb-vacation",
  topic: "Urgent matters while away",
  information: "For anything urgent, call Devi on +62 812 3456 7890.",
});

export const BUDGET = playbook({
  id: "pb-budget",
  topic: "Project Atlas budget",
  information: "Budget figures are confidential.",
  instruction: "Never share budget figures by email. Tell the sender to ask Alex in person.",
});

export const TASKS = playbook({
  id: "pb-tasks",
  topic: "Task requests",
  information:
    "Tasks for Alex are accepted only through the board at https://board.example.com/atlas. Reply that the request needs a ticket on the board and that Alex confirms within 2 working days.",
  instruction: "Never accept a task or promise a delivery date by email.",
});

export const OFFICE = playbook({
  id: "pb-office",
  topic: "Office closure",
  information: "The office is closed on Monday 1 December for the company retreat.",
});

export const INVOICE_CORRECTION = playbook({
  id: "pb-invoice-correction",
  topic: "Invoice corrections",
  information:
    "To correct an invoice, the sender submits the correction form at https://portal.example.com/invoices with the invoice number.",
});

export const PRICING_BASIC = playbook({
  id: "pb-pricing-basic",
  topic: "Atlas Basic plan",
  information:
    "The Atlas Basic plan costs USD 20 per user per month, includes 5 projects and email support.",
});

export const PRICING_PRO = playbook({
  id: "pb-pricing-pro",
  topic: "Atlas Pro plan",
  information:
    "The Atlas Pro plan costs USD 45 per user per month, includes unlimited projects and phone support.",
});

export const MEETING_DESIGN = playbook({
  id: "pb-meeting-design",
  topic: "Atlas design review meeting",
  information:
    "The Atlas design review is on Monday 24 August at 14:00 in Room Merapi, 3rd floor, Jakarta office.",
});

export const MEETING_KICKOFF = playbook({
  id: "pb-meeting-kickoff",
  topic: "Atlas client kickoff meeting",
  information:
    "The Atlas client kickoff is on Tuesday 25 August at 09:30 in Sentosa Hall, Bandung office.",
});
