import { exampleJob } from "./example.js";
import { runAgentJob } from "./run-agent.js";
import type { JobDefinition } from "./types.js";

const jobs: JobDefinition[] = [exampleJob, runAgentJob];

export const jobRegistry = new Map(jobs.map((j) => [j.name, j]));
