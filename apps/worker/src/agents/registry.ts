import type { Agent } from "./types.js";

const agents: Agent[] = [];

export const agentRegistry = new Map(agents.map((a) => [a.id, a]));
