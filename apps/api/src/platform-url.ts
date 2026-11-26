/**
 * Builds the address of a page of the web application. A trailing slash in `platformUrl` is
 * ignored, and `path` starts with a slash.
 */
export function platformLink(platformUrl: string, path: string): string {
  return `${platformUrl.replace(/\/+$/, "")}${path}`;
}
