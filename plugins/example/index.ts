import { createTool } from "@anvia/core";
import { definePlugin } from "@leren/plugin-client";
import { z } from "zod";

/**
 * An example plugin with one tool that reports the current time.
 *
 * Copy this directory to add a plugin. The harness loads every directory in `plugins/` that has a
 * `manifest.json`.
 */
export default definePlugin({
  tools: [
    createTool({
      name: "current_time",
      description: "Returns the current date and time as an ISO 8601 string.",
      inputSchema: z.object({}),
      handler: async () => new Date().toISOString(),
    }),
  ],
});
