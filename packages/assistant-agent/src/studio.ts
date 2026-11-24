import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { Studio } from "@anvia/studio";
import { createAssistantAgent } from "./agent";

const DEFAULT_PORT = 4021;

/** Serves the assistant in Anvia Studio. */
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
