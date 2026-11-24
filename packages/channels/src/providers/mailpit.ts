import type { ChannelProvider } from "./types";

/** The Mailpit provider for development and tests. */
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
