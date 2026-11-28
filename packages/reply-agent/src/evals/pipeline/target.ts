import { createTool } from "@anvia/core";
import type { AnyTool } from "@anvia/core";
import type { EvalTarget } from "@anvia/core/evals";
import { loadHarness, resolveTaskModel } from "@leren/agents";
import { z } from "zod";
import { allowedTools } from "../../agents/drafter/utils/mcp";
import { runReplyPipeline } from "../../pipeline/pipeline";
import { keepAllowed } from "../../pipeline/playbooks";
import type { Playbook } from "../../pipeline/playbooks";
import { readReplyPrompts } from "../../pipeline/prompts";
import type { Email, ReplyResult } from "../../pipeline/types";
import { observer } from "../observer";

/** The input of one pipeline case: the message as the worker passes it, and what search returns. */
export type PipelineCaseInput = {
  email: Email;
  /** Whether the gate asked triage to check that the email addresses the user. */
  checkMention?: boolean;
  replyInstructions?: string;
  /** The user's playbooks that match any query. An empty list is no reliable result. */
  playbooks: readonly Playbook[];
  /**
   * The ids that the email gate allowed for the message. The fake tools return only these
   * playbooks, as a reply session of the MCP server does, and the pipeline gets the same set. Unset
   * means that every playbook of the case is allowed.
   */
  allowedPlaybookIds?: readonly string[];
};

/** What one pipeline run produced, with the ids of the playbooks that the tools could return. */
export type PipelineCaseOutput = {
  result: ReplyResult;
  readableIds: readonly string[];
};

/** The view of a playbook that the real MCP tools return. Every fixture is usable now. */
function toView(item: Playbook) {
  return { ...item, enabled: true, usable: true, periodStatus: "active" };
}

/**
 * Builds fakes of the playbook tools of the MCP server, with the same names, descriptions and
 * result shapes. The search returns every readable playbook of the case for any query, so the case
 * controls exactly what the answering agent finds.
 */
function createFakePlaybookTools(playbooks: readonly Playbook[]): Record<string, AnyTool> {
  return {
    search_playbooks: createTool({
      name: "search_playbooks",
      description:
        "Find the enabled playbooks that are valid now and match a text. Returns no matches when nothing is reliably close.",
      inputSchema: z.object({ query: z.string().min(1).max(2000) }),
      handler: () =>
        playbooks.length === 0
          ? { status: "no_reliable_result", matches: [] }
          : {
              status: "found",
              matches: playbooks.map((item) => ({ score: 0.8, playbook: toView(item) })),
            },
    }),
    get_playbook: createTool({
      name: "get_playbook",
      description: "Get one playbook of the user.",
      inputSchema: z.object({ playbookId: z.string() }),
      handler: ({ playbookId }) => {
        const item = playbooks.find((entry) => entry.id === playbookId);

        if (!item) {
          throw new Error("Not found");
        }

        return toView(item);
      },
    }),
  };
}

const harness = await loadHarness();

const models = {
  triage: resolveTaskModel(harness.config, "replyTriage").key,
  draft: resolveTaskModel(harness.config, "reply").key,
  judge: resolveTaskModel(harness.config, "replyJudge").key,
};

const prompts = await readReplyPrompts(harness);

/**
 * Runs the whole reply pipeline, with the production prompts and models of every stage, against
 * fake playbook tools. The fakes pass through the answering agent's own `allowedTools`, the list
 * that the real MCP connection uses.
 */
export const target: EvalTarget<PipelineCaseInput, PipelineCaseOutput> = async (
  input,
  testCase,
  context,
) => {
  const allowed = input.allowedPlaybookIds && new Set(input.allowedPlaybookIds);
  const readable = keepAllowed(input.playbooks, allowed);
  const names: readonly string[] = allowedTools;

  const result = await runReplyPipeline(
    {
      harness,
      models,
      prompts,
      observer,
      allowedPlaybookIds: allowed,
      tools: Object.entries(createFakePlaybookTools(readable)).flatMap(([name, tool]) =>
        names.includes(name) ? [tool] : [],
      ),
      abortSignal: context?.signal,
    },
    {
      messageId: testCase.id,
      email: input.email,
      checkMention: input.checkMention ?? false,
      replyInstructions: input.replyInstructions,
    },
  );

  return { result, readableIds: readable.map((item) => item.id) };
};
