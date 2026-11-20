export { getAutoReplyStatus } from "./status";

export type { AutoReplyStatus, AutoReplyWindow } from "./status";

export { evaluateEmailConditions } from "./conditions";

export type {
  EmailConditions,
  EmailFacts,
  EmailRecipient,
  EmailVerdict,
  HandleReason,
  MentionDetection,
  RecipientRole,
  SenderMode,
  SkipReason,
  ThreadMode,
} from "./conditions";

export { detectMention } from "./mention";
