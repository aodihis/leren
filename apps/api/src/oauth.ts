import { createHash } from "node:crypto";

/** Returns the PKCE code challenge, the S256 transform of a code verifier (RFC 7636). */
export function codeChallengeOf(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Parses JSON text and returns `undefined` when it is malformed, so the caller can validate it. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
