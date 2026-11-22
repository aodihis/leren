import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptCredentials, encryptCredentials, parseEncryptionKey } from "./crypto";

const key = randomBytes(32);
const ACCOUNT_ID = "6f1c1f3e-0000-4000-8000-000000000001";

describe("channel credential encryption", () => {
  it("decrypts what it encrypted and does not store the plaintext", () => {
    const stored = encryptCredentials(key, ACCOUNT_ID, "secret-refresh-token");

    expect(stored).not.toContain("secret-refresh-token");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptCredentials(key, ACCOUNT_ID, stored)).toBe("secret-refresh-token");
  });

  it("uses a new nonce for every encryption", () => {
    expect(encryptCredentials(key, ACCOUNT_ID, "same")).not.toBe(
      encryptCredentials(key, ACCOUNT_ID, "same"),
    );
  });

  it("does not decrypt for another account", () => {
    const stored = encryptCredentials(key, ACCOUNT_ID, "token");

    expect(() => decryptCredentials(key, "another-account", stored)).toThrow();
  });

  it("does not decrypt with another key or after the text was changed", () => {
    const stored = encryptCredentials(key, ACCOUNT_ID, "token");
    const [version, nonce, tag, ciphertext] = stored.split(".");
    const flipped = `${ciphertext?.startsWith("A") ? "B" : "A"}${ciphertext?.slice(1)}`;

    expect(() => decryptCredentials(randomBytes(32), ACCOUNT_ID, stored)).toThrow();
    expect(() =>
      decryptCredentials(key, ACCOUNT_ID, [version, nonce, tag, flipped].join(".")),
    ).toThrow();
  });

  it("rejects text that is not in the stored format", () => {
    expect(() => decryptCredentials(key, ACCOUNT_ID, "plain text")).toThrow(/malformed/);
    expect(() => decryptCredentials(key, ACCOUNT_ID, "v2.a.b.c")).toThrow(/malformed/);
  });
});

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes encoded as base64", () => {
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
  });

  it("rejects any other length", () => {
    expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => parseEncryptionKey("")).toThrow(/32 bytes/);
  });
});
