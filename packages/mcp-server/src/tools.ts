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
  /**
   * The description of the fields of a playbook, with which of them are required. The API supplies
   * it, because it is derived from the schema that the API validates with. Without it the
   * `describe_playbook_fields` tool is not registered.
   */
  fieldGuide?: unknown;
  /**
   * The tools that read the user's processed mail. The API supplies them, because the message
   * records and their decisions are served by the API. Each is registered only for a session that
   * holds the `messages:read` scope.
   */
  readActions?: McpReadActions;
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

/** The outcome of a read action. */
export type McpReadOutcome =
  | { status: "ok"; data: unknown }
  | { status: "invalid"; message: string }
  | { status: "not_found" };

/**
 * One tool that reads the user's mail. `run` receives the session's user id and the validated
 * arguments, so the user is never an argument, and it must scope every query by that user.
 */
export type McpReadAction = {
  description: string;
  inputSchema: z.ZodObject;
  run: (userId: string, input: never) => Promise<McpReadOutcome>;
};

/** The read actions, keyed by what they do. */
export type McpReadActions = {
  listMessages: McpReadAction;
  getMessage: McpReadAction;
};

/** The names of the tools that read mail. */
export const READ_TOOLS = {
  listMessages: "list_messages",
  getMessage: "get_message",
} as const;

/** The names of the tools that change data. */
export const WRITE_TOOLS = {
  createPlaybook: "create_playbook",
  updatePlaybook: "update_playbook",
} as const;

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

/** Shapes the outcome of an action that did not succeed: an invalid request or an unknown id. */
function failed(
  result: Exclude<McpWriteOutcome | McpReadOutcome, { status: "saved" | "ok" }>,
  summary: Record<string, unknown>,
): ToolOutcome {
  return result.status === "invalid"
    ? { outcome: "invalid", message: result.message, summary }
    : notFound(summary);
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
    information: playbook.information,
    instruction: playbook.instruction,
    startsAt: playbook.startsAt?.toISOString() ?? null,
    endsAt: playbook.endsAt?.toISOString() ?? null,
    timezone: playbook.timezone,
    enabled: playbook.enabled,
    periodStatus: getAutoReplyStatus(playbook, now),
    usable: isKnowledgeUsable(playbook, now),
    conditions: conditions
      .toSorted((a, b) => a.channel.localeCompare(b.channel))
      .map((row) => ({
        ...row.settings,
        channel: row.channel,
        channelAccountId: row.channelAccountId,
      })),
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
    ["playbookId", "messageId"].flatMap((key) =>
      args[key] === undefined ? [] : [[key, args[key]]],
    ),
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

        return result.status === "saved"
          ? { outcome: "ok", data: result.data, summary: { ...summary, savedId: result.id } }
          : failed(result, summary);
      }),
  );
}

/**
 * Registers a tool that reads the user's mail. The call is audited with the ids it names and never
 * with the mail itself.
 */
function registerReadTool(
  server: McpServer,
  name: string,
  action: McpReadAction,
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

        return result.status === "ok"
          ? { outcome: "ok", data: result.data, summary }
          : failed(result, summary);
      }),
  );
}

/**
 * Builds the MCP server of one request for one verified session. A tool, resource or prompt is
 * registered only when the session holds its scope, and no tool takes a user id. Every call that
 * reaches a tool body writes an audit row. Write actions come from the caller.
 */
export function createMcpServer(session: McpSession, deps: McpToolDependencies): McpServer {
  const { db } = deps;
  const clock = deps.now ?? (() => new Date());
  const server = new McpServer({ name: "leren", version: "0.0.0" });

  const holds = (scope: Scope) => session.scopes.includes(scope);

  /**
   * Whether the session may read a playbook. A reply session reads only the playbooks that the
   * email gate allowed for its message, and every other playbook is reported as not found, so the
   * model of the run never sees a playbook that was meant for another sender.
   */
  const canRead = (playbookId: string) =>
    session.playbookIds === null || session.playbookIds.includes(playbookId);

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
                session.playbookIds === null
                  ? undefined
                  : inArray(playbooks.id, [...session.playbookIds]),
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
          const playbook = canRead(playbookId)
            ? await findOwnedPlaybook(db, session.userId, playbookId)
            : undefined;

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

    if (deps.fieldGuide !== undefined) {
      server.registerTool(
        "describe_playbook_fields",
        {
          description:
            "Describe every field of a playbook: its type, whether it is required, its default and what it means. Use it to learn which fields to ask the user for, and to answer a question about how to create a playbook.",
        },
        () =>
          run("describe_playbook_fields", async () => ({
            outcome: "ok",
            data: deps.fieldGuide,
            summary: {},
          })),
      );
    }

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
            { userId: session.userId, text: query, playbookIds: session.playbookIds },
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

        const playbook =
          z.uuid().safeParse(id).success && canRead(id)
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
                "Answer only from the returned playbooks and follow their instructions.",
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

  if (deps.readActions && holds("messages:read")) {
    const readTools = [
      [READ_TOOLS.listMessages, deps.readActions.listMessages],
      [READ_TOOLS.getMessage, deps.readActions.getMessage],
    ] as const;

    for (const [name, action] of readTools) {
      registerReadTool(server, name, action, run, session.userId);
    }
  }

  if (deps.actions) {
    const writeTools = [
      ["playbooks:write", WRITE_TOOLS.createPlaybook, deps.actions.createPlaybook],
      ["playbooks:write", WRITE_TOOLS.updatePlaybook, deps.actions.updatePlaybook],
    ] as const;

    for (const [scope, name, action] of writeTools) {
      if (holds(scope)) {
        registerWriteTool(server, name, action, run, session.userId);
      }
    }
  }

  return server;
}
