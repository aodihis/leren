import { loadHarness } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runAgent } from "./core";

/**
 * Runs the Reply Agent from the command line on one email text and prints the answer.
 *
 * Usage: `pnpm runner:reply "email text"`.
 * It loads `harness.config.ts`, which supplies the prompt, the model, its endpoint and the name of
 * the variable that holds its API key. `HARNESS_MODEL` selects a configured model other than the
 * default. It connects to the MCP server only when `MCP_URL` and `MCP_TOKEN` are set.
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
      model: harness.createModel(process.env.HARNESS_MODEL || undefined),
      observer,
      mcp: url && token ? { url, token } : undefined,
    });

    console.log(answer);
  } finally {
    await observer.close();
  }
}

await main();
