import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Decodes the channel token encryption key. */
export function parseEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");

  if (key.length !== KEY_BYTES) {
    throw new Error(`The encryption key must be ${KEY_BYTES} bytes encoded as base64`);
  }

  return key;
}

/** Encrypts credentials with AES-256-GCM. */
export function encryptCredentials(key: Buffer, accountId: string, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);

  cipher.setAAD(Buffer.from(accountId));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [VERSION, nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Decrypts credentials made by encryptCredentials. */
export function decryptCredentials(key: Buffer, accountId: string, stored: string): string {
  const [version, nonce, tag, ciphertext, ...rest] = stored.split(".");

  if (version !== VERSION || !nonce || !tag || !ciphertext || rest.length > 0) {
    throw new Error("The stored credentials are malformed");
  }

  const authTag = Buffer.from(tag, "base64url");

  if (authTag.length !== TAG_BYTES) {
    throw new Error("The stored credentials are malformed");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(nonce, "base64url"));

  decipher.setAAD(Buffer.from(accountId));
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
