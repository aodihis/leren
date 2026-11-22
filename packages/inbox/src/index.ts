export {
  EMAIL_PROCESS_QUEUE,
  EMAIL_RECEIVED_QUEUE,
  MESSAGE_BODY_LIMIT,
  MESSAGE_SUBJECT_LIMIT,
  recordInboundEmail,
  truncate,
} from "./record";

export type { EmailReceivedMessage, InboundEmail, RecordResult } from "./record";

export { canTransition, transitionMessage } from "./status";

export type { MessageStatus } from "./status";

export { emailProcessMessageSchema, playbookVerdictSchema } from "./process";

export type { EmailProcessMessage } from "./process";
