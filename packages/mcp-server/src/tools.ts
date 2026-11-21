import { getAutoReplyStatus } from "@leren/auto-reply";
import { playbooks, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable, searchKnowledge } from "@leren/knowledge";
import type { KnowledgeSearchDependencies, PlaybookRow } from "@leren/knowledge";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import type { AuditOutcome } from "./audit";
import type { Scope } from "./scopes";
import type { McpSession } from "./sessions";

export type McpToolDependencies = {
  db: Db;
  /** The retrieval collaborators. Without them `search_playbooks` reports that it is unavailable. */
  search?: Pick<KnowledgeSearchDependencies, "store" | "embedder">;
  now?: () => Date;
  /**
   * The tools that create and change playbooks. The API supplies them, because the
   * business rules for saving live there and a package cannot import an app. Without them the
   * write tools are not registered, whatever scopes the session holds.
   */
  actions?: McpWriteActions;
  /** Called after a tool body has run and been audited. */
  onToolAudited?: () => void;
};

/** The outcome of a write action. `saved` carries the id of the playbook that was written. */
export type McpWriteOutcome =
  | { status: "saved"; id: string; data: unknown }
  | { status: "invalid"; message: string }
  | { status: "not_found" };

/**
 * One tool that changes data. `run` receives the session's user id and the validated arguments, so
 * the user is never an argument, and it must scope every query by that user.
 */
export type McpWriteAction = {
  description: string;
  inputSchema: z.ZodObject;
  run: (userId: string, input: never) => Promise<McpWriteOutcome>;
};

/** The write actions, keyed by what they do. */
export type McpWriteActions = {
  createPlaybook: McpWriteAction;
  updatePlaybook: McpWriteAction;
};

type ToolOutcome =
  | { outcome: "ok"; data: unknown; summary: Record<string, unknown> }
  | {
      outcome: Exclude<AuditOutcome, "ok" | "rejected">;
      message: string;
      summary: Record<string, unknown>;
    };

function notFound(summary: Record<string, unknown>): ToolOutcome {
  return { outcome: "not_found", message: "Not found", summary };
}

/**
 * A playbook with its reply conditions, one entry for each channel. Each entry has the channel and
 * the settings of that channel at the same level, the shape that the playbook tools accept.
 * `periodStatus` is derived from the period and `usable` says whether the assistant may use the
 * playbook now.
 */
function toPlaybookView(
  playbook: PlaybookRow,
  conditions: (typeof replyConditions.$inferSelect)[],
  now: Date,
) {
  return {
    id: playbook.id,
    topic: playbook.topic,
    examples: playbook.examples,
    response: playbook.response,
    restrictions: playbook.restrictions,
    contacts: playbook.contacts,
    startsAt: playbook.startsAt?.toISOString() ?? null,
    endsAt: playbook.endsAt?.toISOString() ?? null,
    timezone: playbook.timezone,
    enabled: playbook.enabled,
    periodStatus: getAutoReplyStatus(playbook, now),
    usable: isKnowledgeUsable(playbook, now),
    conditions: conditions
      .toSorted((a, b) => a.channel.localeCompare(b.channel))
      .map((row) => ({ ...row.settings, channel: row.channel })),
  };
}

async function findOwnedPlaybook(db: Db, userId: string, playbookId: string) {
  const [playbook] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, playbookId), eq(playbooks.userId, userId)));

  return playbook;
}

const playbookIdArgs = z.object({ playbookId: z.uuid() });

const listPlaybooksArgs = z.object({
  enabled: z.boolean().optional(),
  usableOnly: z.boolean().optional(),
});

const searchPlaybooksArgs = z.object({ query: z.string().min(1).max(2000) });

type RunTool = (tool: string, body: () => Promise<ToolOutcome>) => Promise<CallToolResult>;

/**
 * The ids in the arguments of a write call. They are the only part of the arguments that is
 * audited, so the text of a playbook never reaches the log.
 */
function pickIds(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    ["playbookId"].flatMap((key) => (args[key] === undefined ? [] : [[key, args[key]]])),
  );
}

/**
 * Registers a tool that changes data. The call is audited with the ids it names and the id it
 * saved, and an unknown id and an invalid change are reported without internals.
 */
function registerWriteTool(
  server: McpServer,
  name: string,
  action: McpWriteAction,
  run: RunTool,
  userId: string,
): void {
  server.registerTool(
    name,
    { description: action.description, inputSchema: action.inputSchema },
    (args: Record<string, unknown>) =>
      run(name, async () => {
        const summary = pickIds(args);
        const result = await action.run(userId, args as never);

        if (result.status === "saved") {
          return { outcome: "ok", data: result.data, summary: { ...summary, savedId: result.id } };
        }

        return result.status === "invalid"
          ? { outcome: "invalid", message: result.message, summary }
          : notFound(summary);
      }),
  );
}

/**
 * Builds the MCP server of one request for one verified session. A tool, resource or prompt is
 * registered only when the session holds its scope, so a call outside the granted scopes is
 * rejected as an unknown name. The user is the session's user, and no tool takes a user id.
 * Every call that reaches a tool body writes an audit row, and the endpoint audits the calls that
 * the SDK rejects first. The tools that change data are the actions that the caller supplies, and
 * each is registered only for a session that holds its write scope.
 */
export function createMcpServer(session: McpSession, deps: McpToolDependencies): McpServer {
  const { db } = deps;
  const clock = deps.now ?? (() => new Date());
  const server = new McpServer({ name: "leren", version: "0.0.0" });

  const holds = (scope: Scope) => session.scopes.includes(scope);

  /**
   * Runs a tool body, audits it and shapes the result. A body that throws is audited as
   * `unavailable` and reports a generic error, so internals are not exposed to the model.
   */
  const run = async (tool: string, body: () => Promise<ToolOutcome>): Promise<CallToolResult> => {
    const result = await body().catch((): ToolOutcome => ({
      outcome: "unavailable",
      message: "The tool failed",
      summary: {},
    }));

    await writeAudit(db, session, tool, result.outcome, result.summary);
    deps.onToolAudited?.();

    if (result.outcome === "ok") {
      return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
    }

    return { isError: true, content: [{ type: "text", text: result.message }] };
  };

  if (holds("playbooks:read")) {
    server.registerTool(
      "list_playbooks",
      {
        description:
          "List the user's playbooks with their conditions, optionally only the enabled or only the disabled ones, or only the playbooks that are usable now.",
        inputSchema: listPlaybooksArgs,
      },
      (args) =>
        run("list_playbooks", async () => {
          const now = clock();

          const rows = await db
            .select()
            .from(playbooks)
            .where(
              and(
                eq(playbooks.userId, session.userId),
                args.enabled === undefined ? undefined : eq(playbooks.enabled, args.enabled),
              ),
            )
            .orderBy(desc(playbooks.createdAt));

          const conditions =
            rows.length === 0
              ? []
              : await db
                  .select()
                  .from(replyConditions)
                  .where(
                    inArray(
                      replyConditions.playbookId,
                      rows.map((row) => row.id),
                    ),
                  );

          const views = rows
            .map((row) =>
              toPlaybookView(
                row,
                conditions.filter((entry) => entry.playbookId === row.id),
                now,
              ),
            )
            .filter((view) => !args.usableOnly || view.usable);

          return {
            outcome: "ok",
            data: { playbooks: views },
            summary: { ...args, count: views.length },
          };
        }),
    );

    server.registerTool(
      "get_playbook",
      { description: "Get one playbook of the user.", inputSchema: playbookIdArgs },
      ({ playbookId }) =>
        run("get_playbook", async () => {
          const playbook = await findOwnedPlaybook(db, session.userId, playbookId);

          if (!playbook) {
            return notFound({ playbookId });
          }

          const conditions = await db
            .select()
            .from(replyConditions)
            .where(eq(replyConditions.playbookId, playbookId));

          return {
            outcome: "ok",
            data: toPlaybookView(playbook, conditions, clock()),
            summary: { playbookId },
          };
        }),
    );

    server.registerTool(
      "search_playbooks",
      {
        description:
          "Find the enabled playbooks that are valid now and match a text. Returns no matches when nothing is reliably close.",
        inputSchema: searchPlaybooksArgs,
      },
      ({ query }) =>
        run("search_playbooks", async () => {
          const summary = { queryLength: query.length };

          if (!deps.search) {
            return { outcome: "unavailable", message: "Search is not configured", summary };
          }

          const now = clock();

          const result = await searchKnowledge(
            { db, ...deps.search },
            { userId: session.userId, text: query },
            { now },
          );

          if (result.status === "no_reliable_result") {
            return { outcome: "ok", data: { status: result.status, matches: [] }, summary };
          }

          const conditions = await db
            .select()
            .from(replyConditions)
            .where(
              inArray(
                replyConditions.playbookId,
                result.matches.map((match) => match.playbook.id),
              ),
            );

          return {
            outcome: "ok",
            data: {
              status: result.status,
              matches: result.matches.map((match) => ({
                score: match.score,
                playbook: toPlaybookView(
                  match.playbook,
                  conditions.filter((entry) => entry.playbookId === match.playbook.id),
                  now,
                ),
              })),
            },
            summary: { ...summary, count: result.matches.length },
          };
        }),
    );

    server.registerResource(
      "playbook",
      new ResourceTemplate("leren://playbooks/{id}", { list: undefined }),
      { description: "One playbook of the user, as JSON." },
      async (uri, variables) => {
        const id = String(variables.id);

        const playbook = z.uuid().safeParse(id).success
          ? await findOwnedPlaybook(db, session.userId, id)
          : undefined;

        await writeAudit(db, session, "resource:playbook", playbook ? "ok" : "not_found", {
          playbookId: id,
        });

        if (!playbook) {
          throw new Error("Not found");
        }

        const conditions = await db
          .select()
          .from(replyConditions)
          .where(eq(replyConditions.playbookId, id));

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(toPlaybookView(playbook, conditions, clock())),
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "answer_from_playbooks",
      {
        description: "Guidance for answering a question only from the user's enabled playbooks.",
        argsSchema: z.object({ question: z.string().min(1).max(2000) }),
      },
      ({ question }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "Call search_playbooks to find playbooks for the question below.",
                "Answer only from the returned playbooks and respect their restrictions.",
                "If the search reports no reliable result, say that the playbooks do not cover it.",
                "",
                `Question: ${question}`,
              ].join("\n"),
            },
          },
        ],
      }),
    );
  }

  if (deps.actions) {
    const writeTools = [
      ["playbooks:write", "create_playbook", deps.actions.createPlaybook],
      ["playbooks:write", "update_playbook", deps.actions.updatePlaybook],
    ] as const;

    for (const [scope, name, action] of writeTools) {
      if (holds(scope)) {
        registerWriteTool(server, name, action, run, session.userId);
      }
    }
  }

  return server;
}
