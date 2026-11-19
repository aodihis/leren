import type { JobDefinition } from "../job";
import { runAgentJob } from "./run-agent/job";

export const jobs: JobDefinition[] = [runAgentJob];
