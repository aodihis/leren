import { playbook } from "./target";

/** The playbooks that the reply evals use. */
export const DEADLINE = playbook({
  id: "pb-deadline",
  topic: "Project Atlas deadline",
  response:
    "The Atlas deliverable is due on Friday 28 November at 17:00 Jakarta time. For questions, contact Devi <devi@email.com>.",
});

export const REFUND = playbook({
  id: "pb-refund",
  topic: "Refund policy",
  response: "Refunds are possible within 30 days of purchase. Send the order number to the user.",
  restrictions: "Never promise a refund after 30 days.",
});

export const VACATION = playbook({
  id: "pb-vacation",
  topic: "Urgent matters while away",
  response: "For anything urgent, call Devi on +62 812 3456 7890.",
});

export const SCOPE = playbook({
  id: "pb-scope",
  topic: "Project Atlas scope",
  response:
    "Atlas covers the customer portal, the billing export and single sign-on. Mobile apps are out of scope.",
});

export const SYNC = playbook({
  id: "pb-sync",
  topic: "Weekly project sync",
  response:
    "The Atlas sync is every Tuesday at 10:00 Jakarta time at https://meet.example.com/atlas-sync.",
});

export const STATUS = playbook({
  id: "pb-status",
  topic: "Project Atlas status",
  response: "Atlas is on track. The beta went to customers on 12 November.",
});

export const BUDGET = playbook({
  id: "pb-budget",
  topic: "Project Atlas budget",
  response: "Budget figures are confidential.",
  restrictions: "Never share budget figures by email. Tell the sender to ask Alex in person.",
});

export const TASKS = playbook({
  id: "pb-tasks",
  topic: "Task requests",
  response:
    "Tasks for Alex are accepted only through the board at https://board.example.com/atlas. Reply that the request needs a ticket on the board and that Alex confirms within 2 working days.",
  restrictions: "Never accept a task or promise a delivery date by email.",
});

export const DESIGN = playbook({
  id: "pb-design",
  topic: "Design requests",
  response:
    "Maya handles every design request, such as banners and logos. Send the request to Maya <maya@example.com>.",
});

export const ONCALL = playbook({
  id: "pb-oncall",
  topic: "Production incident",
  response:
    "For a production outage, call the on-call engineer Rina on +62 811 2222 3333 or write to rina@example.com.",
});

export const OFFICE = playbook({
  id: "pb-office",
  topic: "Office closure",
  response: "The office is closed on Monday 1 December for the company retreat.",
});
