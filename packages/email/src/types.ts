/** A message to deliver. */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** Delivers email. */
export interface EmailSender {
  /** Rejects when the provider cannot be used. */
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<void>;
}
