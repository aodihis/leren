export interface Agent {
  id: string;
  run(input: unknown, ctx: { signal: AbortSignal }): Promise<unknown>;
}
