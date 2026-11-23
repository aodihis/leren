import { LensClient } from "@anvia/lens";
import type { Environment, Observer } from "./observer";
import { createNoopObserver } from "./noop";

/**
 * Creates an observer backed by Anvia Lens, configured from `ANVIA_LENS_*` variables.
 *
 * Returns a no-op observer when none of the connection variables are set. A partial
 * configuration throws, so a misconfigured deployment fails at startup instead of silently
 * dropping traces. Payload capture is `full` (decision 0047): a trace holds the prompts, the replies
 * and the input and output of each pipeline stage, so the email, the playbooks and the reply can be
 * read in Lens. The default redaction patterns of the library still apply.
 */
export function createLensObserver(env: Environment): Observer {
  const client = new LensClient({
    baseUrl: env.ANVIA_LENS_BASE_URL,
    publicKey: env.ANVIA_LENS_PUBLIC_KEY,
    secretKey: env.ANVIA_LENS_SECRET_KEY,
    serviceName: env.ANVIA_LENS_SERVICE_NAME,
    environment: env.ANVIA_LENS_ENVIRONMENT,
    captureMode: "full",
    optional: true,
  });

  if (!client.enabled) {
    return createNoopObserver();
  }

  const tracing = client.observer({ captureMode: "full" });
  const pipelineTracing = client.pipelineObserver({ captureMode: "full" });

  return {
    enabled: true,
    forAgent: () => ({ observers: { lens: tracing }, primaryTrace: "lens" }),
    forPipeline: () => ({ observers: { lens: pipelineTracing }, primaryTrace: "lens" }),
    evalReporter: () => client.evalReporter({ includePayloads: true }),
    flush: () => client.flush(),
    close: () => client.close(),
  };
}
