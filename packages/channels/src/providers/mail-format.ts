const AUTOMATIC_PRECEDENCE = new Set(["bulk", "list", "junk"]);

/**
 * Reads whether a message is a reply and whether it is bulk from its headers, keyed by lower-case
 * name (decision 0041). A message is a reply when it names the message it answers, and it is bulk
 * when its headers say it was sent to a list or by a program. Every provider applies these rules,
 * so the gate treats mail the same whichever mailbox it came from.
 */
export function readMailFlags(headers: ReadonlyMap<string, string>): {
  isReply: boolean;
  isBulk: boolean;
} {
  const autoSubmitted = headers.get("auto-submitted")?.trim().toLowerCase();

  return {
    isReply: headers.has("in-reply-to") || headers.has("references"),
    isBulk:
      headers.has("list-unsubscribe") ||
      AUTOMATIC_PRECEDENCE.has(headers.get("precedence")?.trim().toLowerCase() ?? "") ||
      (autoSubmitted !== undefined && autoSubmitted !== "no"),
  };
}

/** Builds the map that `readMailFlags` reads from a list of headers. */
export function headerMap(
  headers: readonly { name: string; value: string }[],
): Map<string, string> {
  return new Map(headers.map((header) => [header.name.toLowerCase(), header.value]));
}

/**
 * Returns one address for each mailbox in a header such as `Ana <ana@example.com>, bo@example.com`.
 * A mailbox is split from the next at a comma that is outside a quoted display name. Its address is
 * the one in angle brackets when it has one, and the bare address otherwise. Quoted strings are
 * removed first, so an address written inside a display name, with or without angle brackets, is
 * never taken for the address of the mailbox.
 */
export function parseAddresses(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return (value.match(/(?:"(?:[^"\\]|\\.)*"|[^,"])+/g) ?? []).flatMap((mailbox) => {
    const unquoted = mailbox.replace(/"(?:[^"\\]|\\.)*"/g, "");

    const address =
      /<([^<>\s]+@[^<>\s]+)>/.exec(unquoted)?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(unquoted)?.[0];

    return address ? [address.toLowerCase()] : [];
  });
}

/** Converts HTML to plain text by dropping scripts and styles, breaking lines and removing tags. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NOT_REACHED_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Returns the network error code of a failed request when it is known not to have reached the
 * provider, because the connection was refused or the name could not be resolved, and `undefined`
 * otherwise.
 */
export function notReachedCode(error: unknown): string | undefined {
  const code =
    error instanceof Error && error.cause instanceof Error
      ? (error.cause as { code?: unknown }).code
      : undefined;

  return typeof code === "string" && NOT_REACHED_CODES.has(code) ? code : undefined;
}
