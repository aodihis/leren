import { describe, expect, it, vi } from "vitest";

import { parseAutoconfig, suggestImapSettings } from "./imap-discovery";

const AUTOCONFIG = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="acme.com">
    <incomingServer type="pop3">
      <hostname>pop.acme.com</hostname>
      <port>995</port>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.acme.com</hostname>
      <port>25</port>
    </outgoingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.acme.com</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

describe("parseAutoconfig", () => {
  it("takes the first IMAP and SMTP servers on an allowed port", () => {
    expect(parseAutoconfig(AUTOCONFIG, "acme.com")).toEqual({
      imapHost: "imap.acme.com",
      imapPort: 993,
      smtpHost: "smtp.acme.com",
      smtpPort: 587,
    });
  });

  it("finds nothing in a document without an IMAP server", () => {
    expect(parseAutoconfig(AUTOCONFIG.replace('type="imap"', 'type="exchange"'), "acme.com")).toBe(
      null,
    );
  });
});

describe("suggestImapSettings", () => {
  it("uses the domain's own autoconfig document first, without following redirects", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(AUTOCONFIG));

    const suggested = await suggestImapSettings("me@acme.com", {
      fetch: send,
      resolve: PUBLIC,
      resolveSrv: vi.fn(),
    });

    expect(suggested).toMatchObject({ imapHost: "imap.acme.com" });
    expect(send).toHaveBeenCalledOnce();
    expect(String(send.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/autoconfig\.acme\.com\/mail\/config-v1\.1\.xml/,
    );
    expect(send.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("does not request a document from a host that is not public", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(AUTOCONFIG));

    const suggested = await suggestImapSettings("me@acme.com", {
      fetch: send,
      resolve: async (host) =>
        host.startsWith("autoconfig.acme") ? [{ address: "10.0.0.1", family: 4 }] : PUBLIC(),
      resolveSrv: vi.fn(),
    });

    expect(suggested).toMatchObject({ imapHost: "imap.acme.com" });
    expect(send).toHaveBeenCalledOnce();
    expect(String(send.mock.calls[0]?.[0])).toContain("autoconfig.thunderbird.net");
  });

  it("falls back to the SRV records when no document is found", async () => {
    const records: Record<string, { name: string; port: number; priority: number }[]> = {
      "_imaps._tcp.acme.com": [
        { name: "backup.acme.com", port: 993, priority: 20 },
        { name: "imap.acme.com", port: 993, priority: 10 },
      ],
      "_submission._tcp.acme.com": [{ name: "smtp.acme.com", port: 587, priority: 0 }],
    };

    const suggested = await suggestImapSettings("me@acme.com", {
      fetch: vi.fn<typeof fetch>(async () => new Response("", { status: 404 })),
      resolve: PUBLIC,
      resolveSrv: async (name) => {
        const found = records[name];

        if (!found) {
          throw new Error("ENOTFOUND");
        }

        return found;
      },
    });

    expect(suggested).toEqual({
      imapHost: "imap.acme.com",
      imapPort: 993,
      smtpHost: "smtp.acme.com",
      smtpPort: 587,
    });
  });

  it("returns null when nothing is found", async () => {
    const suggested = await suggestImapSettings("me@acme.com", {
      fetch: vi.fn<typeof fetch>(async () => new Response("", { status: 404 })),
      resolve: PUBLIC,
      resolveSrv: async () => [],
    });

    expect(suggested).toBe(null);
  });
});
