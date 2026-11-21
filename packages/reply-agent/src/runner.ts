import { createModel } from "@leren/agents";
import { createObserver } from "@leren/observability";
import { runAgent } from "./core";

/**
 * Runs the Reply Agent from the command line on one email text and prints the answer.
 *
 * Usage: `pnpm runner:reply "email text"`. It reads `OPENAI_API_KEY` and `OPENAI_MODEL`.
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
      'Usage: pnpm runner:reply "email text" (needs OPENAI_API_KEY and OPENAI_MODEL)',
    );
  }

  const observer = createObserver();

  try {
    const answer = await runAgent({
      prompt,
      model: createModel({ apiKey, modelId, baseUrl, api }),
      observer,
      mcp: url && token ? { url, token } : undefined,
    });

    console.log(answer);
  } finally {
    await observer.close();
  }
}

await main();
