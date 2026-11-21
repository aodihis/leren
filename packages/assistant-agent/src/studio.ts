import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { Studio } from "@anvia/studio";
import { createAssistantAgent } from "./core";

const DEFAULT_PORT = 4021;

/**
 * Serves the Assistant Agent in Anvia Studio so that it can be tried in a browser without the
 * application's own frontend or backend. This is a development tool only.
 *
 * Usage: `pnpm studio:assistant`, then open http://localhost:4021/ui/playground.
 * The prompt and model come from `harness.config.ts`. The agent connects to the MCP server only
 * when `MCP_URL` and `MCP_TOKEN` are set. `STUDIO_PORT` changes the port.
 */
async function main(): Promise<void> {
  const url = process.env.MCP_URL;
  const token = process.env.MCP_TOKEN;
  const harness = await loadHarness();
  const observer = createObserver();

  const { agent, close } = await createAssistantAgent({
    instructions: await harness.readPrompt("assistant"),
    model: harness.createModel("assistant"),
    observer,
    mcp: url && token ? { url, token } : undefined,
  });

  const studio = new Studio([agent]);

  try {
    await studio.serve({ port: Number(process.env.STUDIO_PORT ?? DEFAULT_PORT) });
  } finally {
    await close();
    await observer.close();
  }
}

await main();
