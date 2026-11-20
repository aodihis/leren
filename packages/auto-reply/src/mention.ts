/**
 * Escapes the characters of `text` that have a meaning in a regular expression.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reports whether `body` addresses the user by one of `names`. A name matches only as a whole
 * word, ignoring case, so "Ann" does not match "Annual". Blank names are ignored, and an empty
 * list never matches.
 */
export function detectMention(body: string, names: readonly string[]): boolean {
  return names
    .flatMap((name) => (name.trim().length > 0 ? [name.trim()] : []))
    .some((name) => {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
        "iu",
      );

      return pattern.test(body);
    });
}
