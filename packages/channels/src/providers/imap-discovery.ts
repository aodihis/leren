import { resolveSrv } from "node:dns/promises";

import { IMAP_PORTS, SMTP_PORTS } from "./imap-settings";
import { resolvePublicAddress } from "./net-guard";
import type { ResolveHost } from "./net-guard";

/** The server settings suggested for an address. The user can change each of them. */
export type SuggestedSettings = {
  imapHost: string;
  imapPort: (typeof IMAP_PORTS)[number];
  smtpHost: string;
  smtpPort: (typeof SMTP_PORTS)[number];
};

type Server = { host: string; port: number };

export type DiscoveryDependencies = {
  fetch?: typeof fetch;
  resolveSrv?: (name: string) => Promise<{ name: string; port: number; priority: number }[]>;
  resolve?: ResolveHost;
};

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 100_000;

function isImapPort(port: number): port is SuggestedSettings["imapPort"] {
  return (IMAP_PORTS as readonly number[]).includes(port);
}

function isSmtpPort(port: number): port is SuggestedSettings["smtpPort"] {
  return (SMTP_PORTS as readonly number[]).includes(port);
}

function complete(
  incoming: Server | undefined,
  outgoing: Server | undefined,
): SuggestedSettings | null {
  if (!incoming || !outgoing || !isImapPort(incoming.port) || !isSmtpPort(outgoing.port)) {
    return null;
  }

  return {
    imapHost: incoming.host,
    imapPort: incoming.port,
    smtpHost: outgoing.host,
    smtpPort: outgoing.port,
  };
}

/**
 * Reads the servers of a Thunderbird autoconfig document. Only servers on a port that the provider
 * allows are taken, and `%EMAILDOMAIN%` in a host name is replaced by the domain.
 */
export function parseAutoconfig(xml: string, domain: string): SuggestedSettings | null {
  const servers = (
    kind: "incomingServer" | "outgoingServer",
    type: string,
    allowed: (port: number) => boolean,
  ) =>
    [...xml.matchAll(new RegExp(`<${kind}\\s+type="${type}"\\s*>([\\s\\S]*?)</${kind}>`, "g"))]
      .map((match) => ({
        host: (/<hostname>\s*([^<\s]+)\s*<\/hostname>/.exec(match[1] ?? "")?.[1] ?? "")
          .replaceAll("%EMAILDOMAIN%", domain)
          .toLowerCase(),
        port: Number(/<port>\s*(\d+)\s*<\/port>/.exec(match[1] ?? "")?.[1]),
      }))
      .find((server) => server.host !== "" && allowed(server.port));

  return complete(
    servers("incomingServer", "imap", isImapPort),
    servers("outgoingServer", "smtp", isSmtpPort),
  );
}

/**
 * Reads the body of a response as text, or returns null as soon as it exceeds
 * `MAX_DOCUMENT_BYTES`, so a large body is never held in memory.
 */
async function readLimitedText(response: Response): Promise<string | null> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();

      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readDocument(
  send: typeof fetch,
  url: string,
  resolve: ResolveHost | undefined,
): Promise<string | null> {
  try {
    await resolvePublicAddress(new URL(url).hostname, resolve);

    const response = await send(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return await readLimitedText(response);
  } catch {
    return null;
  }
}

async function srvServer(
  lookup: NonNullable<DiscoveryDependencies["resolveSrv"]>,
  name: string,
): Promise<Server | undefined> {
  try {
    const [record] = (await lookup(name)).toSorted((a, b) => a.priority - b.priority);

    return record && record.name !== "." && record.name !== ""
      ? { host: record.name.toLowerCase(), port: record.port }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Suggests the server settings of an address (decision 0063). It tries the domain's own autoconfig
 * document, then Mozilla's database, then the DNS SRV records of RFC 6186 and RFC 8314, and returns
 * the first complete answer, or null when none is found. Requests use HTTPS, follow no redirect and
 * reach only public addresses.
 */
export async function suggestImapSettings(
  address: string,
  dependencies: DiscoveryDependencies = {},
): Promise<SuggestedSettings | null> {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  const send = dependencies.fetch ?? fetch;
  const lookup = dependencies.resolveSrv ?? resolveSrv;

  for (const url of [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(address)}`,
    `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
  ]) {
    const document = await readDocument(send, url, dependencies.resolve);
    const suggested = document ? parseAutoconfig(document, domain) : null;

    if (suggested) {
      return suggested;
    }
  }

  const [imaps, imap, submissions, submission] = await Promise.all([
    srvServer(lookup, `_imaps._tcp.${domain}`),
    srvServer(lookup, `_imap._tcp.${domain}`),
    srvServer(lookup, `_submissions._tcp.${domain}`),
    srvServer(lookup, `_submission._tcp.${domain}`),
  ]);

  return complete(imaps ?? imap, submissions ?? submission);
}
