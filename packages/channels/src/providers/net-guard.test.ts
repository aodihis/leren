import { describe, expect, it, vi } from "vitest";

import { HostNotAllowedError, isPublicAddress, resolvePublicAddress } from "./net-guard";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "not-an-address",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe("resolvePublicAddress", () => {
  it("returns the first address of a host whose addresses are all public", async () => {
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    expect(await resolvePublicAddress("mail.example.com", resolve)).toBe("93.184.216.34");
    expect(resolve).toHaveBeenCalledWith("mail.example.com");
  });

  it("refuses a host when any of its addresses is not public", async () => {
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);

    await expect(resolvePublicAddress("mixed.example.com", resolve)).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
  });

  it("checks an IP address without resolving it", async () => {
    const resolve = vi.fn();

    await expect(resolvePublicAddress("127.0.0.1", resolve)).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a host that has no address", async () => {
    await expect(resolvePublicAddress("empty.example.com", async () => [])).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
  });
});
