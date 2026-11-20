/**
 * A message to deliver. Every message carries a plain-text body so that clients that do not render
 * HTML still show the content. The HTML body is optional.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Delivers email. Implementations reject when the message could not be handed to the provider.
 * The `from` address is part of the sender's configuration, not of the message.
 */
export interface EmailSender {
  /** Rejects when the provider cannot be reached or refuses the configured credentials. */
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<void>;
}
