import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runAgent } from "./core";

/**
 * Runs the Assistant Agent from the command line and prints its answer as it streams.
 *
 * Usage: `pnpm runner:assistant "your question"`.
 * It loads `harness.config.ts`, which supplies the prompt, the model, its endpoint and the name of
 * the variable that holds its API key. The model is the one that `ASSISTANT_MODEL` selects, or the
 * default model. It connects to the MCP server only when `MCP_URL` and `MCP_TOKEN` are set.
 */
async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ");
  const url = process.env.MCP_URL;
  const token = process.env.MCP_TOKEN;

  if (!prompt) {
    throw new Error('Usage: pnpm runner:assistant "your question"');
  }

  const harness = await loadHarness();

  const observer = createObserver();

  try {
    const events = runAgent({
      prompt,
      instructions: await harness.readPrompt("assistant"),
      model: harness.createModel("assistant"),
      observer,
      mcp: url && token ? { url, token } : undefined,
    });

    for await (const event of events) {
      if (event.type === "text_delta") {
        process.stdout.write(event.delta);
      }

      if (event.type === "error") {
        throw event.error;
      }
    }

    process.stdout.write("\n");
  } finally {
    await observer.close();
  }
}

await main();
