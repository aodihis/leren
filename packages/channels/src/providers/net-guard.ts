import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/** Resolves a host name to every address it has. */
export type ResolveHost = (host: string) => Promise<{ address: string; family: number }[]>;

const resolveWithDns: ResolveHost = (host) => lookup(host, { all: true, verbatim: true });

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
];

const BLOCKED_V6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const blocked = new BlockList();

for (const [network, prefix] of BLOCKED_V4) {
  blocked.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of BLOCKED_V6) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** Thrown when a host resolves to an address that the product does not connect to. */
export class HostNotAllowedError extends Error {
  constructor(host: string) {
    super(`The host ${host} is not a public address`);
    this.name = "HostNotAllowedError";
  }
}

/**
 * Whether an address is on the public internet. Loopback, private, link-local, shared,
 * multicast, reserved and unspecified addresses are not, for IPv4 and IPv6. An IPv4 address that is
 * written as IPv6 is checked as IPv4.
 */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];

  if (mapped) {
    return !blocked.check(mapped, "ipv4");
  }

  const family = isIP(address);

  if (family === 0) {
    return false;
  }

  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Resolves a host that a user chose and returns the address to connect to (decision 0063). Every
 * address of the host must be public. The caller connects to the returned address with the host
 * name as the TLS server name, so a later DNS change cannot redirect the connection.
 */
export async function resolvePublicAddress(
  host: string,
  resolve: ResolveHost = resolveWithDns,
): Promise<string> {
  const family = isIP(host);
  const addresses = family === 0 ? await resolve(host) : [{ address: host, family }];
  const first = addresses[0];

  if (!first || !addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new HostNotAllowedError(host);
  }

  return first.address;
}
