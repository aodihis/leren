import { suggestImapSettings } from "./imap-discovery";
import {
  createImapDraft,
  fetchNewImapMail,
  mailboxIdentity,
  readImapPosition,
  readImapReplyContext,
  sendImapReply,
  withClient,
} from "./imap-mail";
import { createMailServers } from "./imap-servers";
import type { MailServers } from "./imap-servers";
import { imapSettingsSchema, readStoredSettings } from "./imap-settings";
import type { MailDeliverer, MailReader, SignInProvider } from "./types";

/**
 * The provider of mailboxes reached with IMAP and SMTP (decision 0063), such as the mailbox that
 * comes with a domain or a web hosting plan. Connecting signs in to both servers with the settings
 * the user gives, and the account is saved only when both sign-ins succeed. The settings and the
 * password are stored as the account's access token, which never expires, so `refresh` returns it
 * unchanged. A password cannot be revoked by the product, so `revoke` does nothing.
 */
export function createImapProvider(
  servers: MailServers = createMailServers(),
): SignInProvider & MailReader & MailDeliverer {
  return {
    name: "imap",
    channel: "email",
    displayName: "Other email (IMAP)",
    async signIn(input) {
      const settings = imapSettingsSchema.parse(input);
      const client = await servers.openImap(settings);
      const syncCursor = await withClient(client, () => readImapPosition(client));
      const smtp = await servers.openSmtp(settings);

      smtp.quit();

      return {
        providerAccountId: mailboxIdentity(settings),
        label: settings.address,
        tokens: { accessToken: JSON.stringify(settings), refreshToken: null, expiresAt: null },
        syncCursor,
      };
    },
    suggestSettings(address) {
      return suggestImapSettings(address);
    },
    async refresh(tokens) {
      return tokens;
    },
    async revoke() {},
    fetchNewMail(accessToken, cursor) {
      return fetchNewImapMail(servers, readStoredSettings(accessToken), cursor);
    },
    readReplyContext(accessToken, providerMessageId) {
      return readImapReplyContext(servers, readStoredSettings(accessToken), providerMessageId);
    },
    createDraft(accessToken, reply) {
      return createImapDraft(servers, readStoredSettings(accessToken), reply);
    },
    sendReply(accessToken, reply) {
      return sendImapReply(servers, readStoredSettings(accessToken), reply);
    },
  };
}
