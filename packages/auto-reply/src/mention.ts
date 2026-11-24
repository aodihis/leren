/** Escapes regular expression characters. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reports whether a body addresses the user by name. */
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
