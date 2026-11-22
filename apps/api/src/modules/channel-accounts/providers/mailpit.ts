import type { ChannelProvider } from "./types";

/**
 * The Mailpit provider for the `email` channel, for development and tests only (decision 0038).
 * Mailpit has no OAuth step and no credentials, so connecting creates the account at once and
 * identifies it by the sign-in address of the user.
 */
export function createMailpitProvider(): ChannelProvider {
  return {
    name: "mailpit",
    channel: "email",
    displayName: "Mailpit (development)",
    start({ userEmail }) {
      return {
        kind: "connected",
        account: { providerAccountId: userEmail, label: userEmail, tokens: null },
      };
    },
    async finish() {
      throw new Error("Mailpit has no authorization step");
    },
    async refresh(tokens) {
      return tokens;
    },
    async revoke() {},
  };
}
