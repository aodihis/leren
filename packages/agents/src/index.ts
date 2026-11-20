export { MODEL_TASK_ENV, defineHarnessConfig, resolveTaskModel } from "./config";

export type {
  AgentName,
  HarnessConfig,
  ModelApi,
  ModelDefinition,
  ModelTask,
  ReasoningEffort,
  ResolvedModel,
} from "./config";

export { createAgent } from "./factory";

export type { CreateAgentOptions } from "./factory";

export { connectMcp, restrictTools } from "./mcp";

export type { McpConnection, McpConnectionOptions, McpOptions } from "./mcp";

export { createModel } from "./model";

export type { ModelOptions } from "./model";
