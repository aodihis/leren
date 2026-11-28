import { defineEvalCases } from "@anvia/core/evals";
import {
  BUDGET,
  CANCEL_PAYMENT,
  CANCEL_RESERVATION,
  DEADLINE,
  INVOICE_CORRECTION,
  MEETING_DESIGN,
  MEETING_KICKOFF,
  OFFICE,
  REFUND,
  SYNC,
  VACATION,
} from "../drafter/fixtures";
import type { QualityExpectation } from "./judge";
import type { PipelineCaseInput } from "./target";

const SENDER = "Sam Lee <sam@client.example>";

const MEETINGS = [MEETING_DESIGN, MEETING_KICKOFF];

const CANCELLATIONS = [CANCEL_PAYMENT, CANCEL_RESERVATION];

/**
 * Cases for the quality of the whole pipeline's final reply, graded by judges against written
 * criteria. The search returns every playbook of a case for any query, ordered by the case's
 * ranking, so the answering agent must pick the playbooks that answer the email.
 */
export const qualityCases = defineEvalCases([
  {
    id: "good-refund-steps",
    input: {
      email: { from: SENDER, subject: "Refund", body: "Hi, how do I get a refund for my order?" },
      playbooks: [REFUND],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-refund"],
      criteria:
        "The body says that refunds are possible only within 30 days of purchase and that the sender must send the order number with the refund request. It does not promise a refund.",
    } satisfies QualityExpectation,
    metadata: { note: "Good case: one playbook is found, and its rule and step reach the sender." },
  },
  {
    id: "good-pick-relevant",
    input: {
      email: {
        from: SENDER,
        subject: "Invoice",
        body: "Hi, my last invoice has the wrong company address. How do I get it fixed?",
      },
      playbooks: [OFFICE, SYNC, INVOICE_CORRECTION, VACATION],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-invoice-correction"],
      criteria:
        "The body tells the sender to submit the correction form at https://portal.example.com/invoices with the invoice number. It says nothing about the office closure, the weekly sync or urgent contacts.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Good case: several unrelated playbooks are found, and only the relevant one is used.",
    },
  },
  {
    id: "date-location-kickoff",
    input: {
      email: {
        from: SENDER,
        subject: "Kickoff",
        body: "Hi, when and where is the Atlas client kickoff?",
      },
      playbooks: MEETINGS,
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-meeting-kickoff"],
      criteria:
        "The body says that the Atlas client kickoff is on 25 August at 09:30 in Sentosa Hall at the Bandung office. It does not mention 24 August, 14:00, Room Merapi or the Jakarta office.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Good case: the exact date, time, room and city of one meeting, without the other meeting.",
    },
  },
  {
    id: "date-location-not-stated",
    input: {
      email: {
        from: SENDER,
        subject: "Kickoff venue",
        body: "Hi, which floor is Sentosa Hall on, and is there parking at the Bandung office?",
      },
      playbooks: MEETINGS,
    } satisfies PipelineCaseInput,
    expected: {
      outcome: ["answer", "escalate"],
      criteria:
        "The body does not state a floor for Sentosa Hall and says nothing about parking being available or unavailable. It does not present the 3rd floor of the Jakarta office as the floor of Sentosa Hall.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the playbooks name the venue but not its floor or parking, so neither may be invented.",
    },
  },
  {
    id: "cancel-payment",
    input: {
      email: {
        from: SENDER,
        subject: "Offsite payment",
        body: "Hi, I paid for the Atlas offsite by mistake an hour ago. How do I cancel the payment?",
      },
      playbooks: CANCELLATIONS,
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-cancel-payment"],
      criteria:
        "The body tells the sender to cancel the payment at https://pay.example.com/cancel with the booking reference within 24 hours of paying. It does not mention reservations@hotel.example, check-in or a cancellation fee of one night's rate.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: two cancellation playbooks share the booking reference and the 24 hours, and only the payment steps are right.",
    },
  },
  {
    id: "cancel-reservation",
    input: {
      email: {
        from: SENDER,
        subject: "Offsite room",
        body: "Hi, I can no longer join the Atlas offsite. How do I cancel my room reservation?",
      },
      playbooks: CANCELLATIONS,
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-cancel-reservation"],
      criteria:
        "The body tells the sender to email reservations@hotel.example with the booking reference at least 24 hours before check-in, and says that a later cancellation costs one night's rate. It does not mention https://pay.example.com/cancel or money returning to a card.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the mirror of cancel-payment, so that a reply that always picks one playbook fails one of them.",
    },
  },
  {
    id: "playbook-instruction-refund-late",
    input: {
      email: {
        from: SENDER,
        subject: "Refund",
        body: "Hi, I bought the plan 45 days ago and I am not happy with it. Can I still get a refund?",
      },
      playbooks: [REFUND],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-refund"],
      criteria:
        "The body says that refunds are possible only within 30 days of purchase. It does not promise a refund, and it does not say that a refund is possible for this purchase.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the purchase is outside the window, and the playbook instruction forbids promising a refund.",
    },
  },
  {
    id: "playbook-instruction-budget",
    input: {
      email: {
        from: SENDER,
        subject: "Budget",
        body: "Hi, what is the total Atlas budget for next quarter?",
      },
      playbooks: [BUDGET],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: ["answer", "escalate"],
      criteria: "The body states no budget figure and tells the sender to ask Alex in person.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the playbook instruction forbids sharing budget figures by email and says what to tell the sender instead.",
    },
  },
  {
    id: "reply-instructions-style",
    input: {
      email: { from: SENDER, subject: "Deadline", body: "Hi, when is the Atlas deadline?" },
      replyInstructions: "Reply in Bahasa Indonesia. Always sign off as Alex.",
      playbooks: [DEADLINE],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-deadline"],
      criteria:
        "The body is written in Bahasa Indonesia, ends with a sign-off as Alex, and says that the Atlas deliverable is due on Friday 28 November at 17:00 Jakarta time.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Good case: the user's reply instructions are applied by the style step, and the facts survive it.",
    },
  },
  {
    id: "multi-question-all-covered",
    input: {
      email: {
        from: SENDER,
        subject: "Atlas",
        body: "Hi, two things: when is the Atlas deadline, and what is the link for the weekly sync?",
      },
      playbooks: [DEADLINE, SYNC, OFFICE],
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-deadline", "pb-sync"],
      criteria:
        "The body says that the Atlas deliverable is due on Friday 28 November at 17:00 Jakarta time, and gives the sync link https://meet.example.com/atlas-sync. It says nothing about the office closure.",
    } satisfies QualityExpectation,
    metadata: { note: "Good case: both questions are answered, each from its own playbook." },
  },
  {
    id: "multi-question-similar-topics",
    input: {
      email: {
        from: SENDER,
        subject: "Offsite",
        body: "Hi, I need to drop out of the Atlas offsite. How do I cancel my payment, and how do I cancel my room reservation?",
      },
      playbooks: CANCELLATIONS,
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-cancel-payment", "pb-cancel-reservation"],
      criteria:
        "The body says that the payment is cancelled at https://pay.example.com/cancel within 24 hours of paying, and that the reservation is cancelled by emailing reservations@hotel.example at least 24 hours before check-in. Each step is given for the right cancellation and not swapped. The fee of one night's rate is tied only to the reservation.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: two questions on similar topics, where the steps of one must not be given for the other.",
    },
  },
  {
    id: "date-wrong-one-ranks-first",
    input: {
      email: {
        from: SENDER,
        subject: "Meeting",
        body: "Hi, can you confirm the time and the room for the meeting on 25 August?",
      },
      playbooks: MEETINGS,
      ranking: { "pb-meeting-design": 0.91, "pb-meeting-kickoff": 0.84 },
    } satisfies PipelineCaseInput,
    expected: {
      outcome: "answer",
      cites: ["pb-meeting-kickoff"],
      criteria:
        "The body says that the meeting on 25 August is at 09:30 in Sentosa Hall at the Bandung office. It does not mention 14:00, Room Merapi or 24 August.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the search ranks the meeting of a nearby date above the right one, as a vector search can.",
    },
  },
  {
    id: "date-no-exact-match",
    input: {
      email: {
        from: SENDER,
        subject: "Meeting",
        body: "Hi, where is the meeting on 26 August?",
      },
      playbooks: MEETINGS,
      ranking: { "pb-meeting-kickoff": 0.9, "pb-meeting-design": 0.88 },
    } satisfies PipelineCaseInput,
    expected: {
      outcome: ["answer", "escalate"],
      criteria:
        "The body does not present the meeting of 24 August or of 25 August as a meeting on 26 August, and states no time or room for a meeting on 26 August.",
    } satisfies QualityExpectation,
    metadata: {
      note: "Bad case: the search returns meetings on nearby dates but none on the date asked about.",
    },
  },
]);
