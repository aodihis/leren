import type { JobDefinition } from "../job";
import { createKnowledgeDriftJob, createKnowledgeIndexJob } from "./knowledge-index/job";
import type { KnowledgeIndexDependencies } from "./knowledge-index/service";
import { runAgentJob } from "./run-agent/job";

export type JobDependencies = KnowledgeIndexDependencies;

/**
 * Builds every job the worker consumes. Jobs that need collaborators receive them here, so tests
 * and the entry point choose the database, the vector store and the embedder.
 */
export function createJobs(dependencies: JobDependencies): JobDefinition[] {
  return [
    runAgentJob,
    createKnowledgeIndexJob(dependencies),
    createKnowledgeDriftJob(dependencies),
  ];
}
