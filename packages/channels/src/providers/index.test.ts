import { describe, expect, it } from "vitest";

import { createChannelProviders } from "./index";
import type { RedirectProvider } from "./types";

const start = {
  state: "state",
  codeChallenge: "challenge",
  redirectUri: "https://api.test/callback",
  userEmail: "ada@example.com",
};

/** The authorization URL that a redirect provider starts a connection with. */
function authorizationUrl(provider: RedirectProvider | undefined): URL {
  const started = provider?.start(start);

  if (started?.kind !== "redirect") {
    throw new Error("The provider did not redirect");
  }

  return new URL(started.url);
}

describe("createChannelProviders", () => {
  it("builds only the enabled providers, keyed by name", () => {
    const providers = createChannelProviders({ CHANNEL_PROVIDERS: ["imap", "mailpit"] });

    expect([...providers.keys()]).toEqual(["imap", "mailpit"]);
    expect(providers.get("imap")?.name).toBe("imap");
    expect(providers.get("mailpit")?.name).toBe("mailpit");
  });

  it("builds every OAuth provider with its own client id", () => {
    const providers = createChannelProviders({
      CHANNEL_PROVIDERS: ["google", "microsoft", "zoho"],
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      MICROSOFT_CLIENT_ID: "microsoft-id",
      MICROSOFT_CLIENT_SECRET: "microsoft-secret",
      ZOHO_CLIENT_ID: "zoho-id",
      ZOHO_CLIENT_SECRET: "zoho-secret",
      ZOHO_REGION: "eu",
    });

    const urlOf = (name: string) =>
      authorizationUrl(providers.get(name) as RedirectProvider | undefined);

    expect(urlOf("google").searchParams.get("client_id")).toBe("google-id");
    expect(urlOf("microsoft").searchParams.get("client_id")).toBe("microsoft-id");
    expect(urlOf("zoho").searchParams.get("client_id")).toBe("zoho-id");
    expect(urlOf("zoho").hostname).toBe("accounts.zoho.eu");
  });

  it("uses Zoho's global region and empty credentials when they are not set", () => {
    const providers = createChannelProviders({
      CHANNEL_PROVIDERS: ["google", "microsoft", "zoho"],
    });

    const zoho = authorizationUrl(providers.get("zoho") as RedirectProvider | undefined);

    expect(zoho.hostname).toBe("accounts.zoho.com");
    expect(zoho.searchParams.get("client_id")).toBe("");
    expect(providers.get("google")?.name).toBe("google");
    expect(providers.get("microsoft")?.name).toBe("microsoft");
  });
});
