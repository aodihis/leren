import { createLensObserver } from "./lens";
import type { Environment, Observer } from "./observer";

export type { Environment, Observer } from "./observer";

export { createNoopObserver } from "./noop";

export { redact } from "./redaction";

export const logger = {
  info: (msg: string, meta?: unknown) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg: string, meta?: unknown) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg: string, meta?: unknown) => console.error(`[error] ${msg}`, meta ?? ""),
};

/**
 * Creates the process-wide observer from environment variables.
 *
 * The package decides whether observability is configured. When it is not, the returned observer
 * is a no-op, so callers never branch on configuration. Applications create one observer at
 * startup and call `close` during graceful shutdown.
 */
export function createObserver(env: Environment = process.env): Observer {
  return createLensObserver(env);
}
