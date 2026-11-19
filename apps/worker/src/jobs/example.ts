import { z } from "zod";
import { defineJob } from "./types.js";

export const exampleJob = defineJob({
  name: "example",
  schema: z.object({ message: z.string() }),
  maxAttempts: 3,
  async handler({ message }, ctx) {
    console.log(`[example] job=${ctx.jobId} attempt=${ctx.attempt} message=${message}`);
  },
});
