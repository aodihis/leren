import { createModel } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runAgent } from "./core";

/**
 * Runs the Assistant Agent from the command line and prints its answer as it streams.
 *
 * Usage: `pnpm runner:assistant "your question"`. It reads `OPENAI_API_KEY` and `OPENAI_MODEL`.
 * `OPENAI_BASE_URL` and `OPENAI_API`
 * select another OpenAI-compatible endpoint and its wire protocol. It connects to the
 * MCP server only when `MCP_URL` and `MCP_TOKEN` are set.
 */
async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ");
  const apiKey = process.env.OPENAI_API_KEY;
  const modelId = process.env.OPENAI_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL || undefined;
  const api = process.env.OPENAI_API === "chat" ? "chat" : "responses";
  const url = process.env.MCP_URL;
  const token = process.env.MCP_TOKEN;

  if (!prompt || !apiKey || !modelId) {
    throw new Error(
      'Usage: pnpm runner:assistant "prompt" (needs OPENAI_API_KEY and OPENAI_MODEL)',
    );
  }

  const observer = createObserver();

  try {
    const events = runAgent({
      prompt,
      model: createModel({ apiKey, modelId, baseUrl, api }),
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
