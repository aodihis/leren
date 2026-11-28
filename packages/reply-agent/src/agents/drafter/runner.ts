import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runAgent } from "./agent";

/**
 * Runs the Reply Agent from the command line on one email text and prints the answer.
 *
 * Usage: `pnpm runner:reply "email text"`. The prompt and model come from `harness.config.ts`,
 * where `REPLY_MODEL` selects the model. It connects to the MCP server only when `MCP_URL` and
 * `MCP_TOKEN` are set.
 */
async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ");
  const url = process.env.MCP_URL;
  const token = process.env.MCP_TOKEN;

  if (!prompt) {
    throw new Error('Usage: pnpm runner:reply "email text"');
  }

  const harness = await loadHarness();

  const observer = createObserver();

  try {
    const answer = await runAgent({
      prompt,
      instructions: await harness.readPrompt("reply"),
      model: harness.createModel("reply"),
      observer,
      mcp: url && token ? { url, token } : undefined,
    });

    console.log(answer);
  } finally {
    await observer.close();
  }
}

await main();
