import { autoReplyRules, knowledgeItems, replyConditions } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable, searchKnowledge } from "@leren/knowledge";
import type { KnowledgeItemRow, KnowledgeSearchDependencies } from "@leren/knowledge";
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
  /** The retrieval collaborators. Without them `search_knowledge` reports that it is unavailable. */
  search?: Pick<KnowledgeSearchDependencies, "store" | "embedder">;
  now?: () => Date;
  /**
   * The tools that create and change rules and knowledge. The API supplies them, because the
   * business rules for saving live there and a package cannot import an app. Without them the
   * write tools are not registered, whatever scopes the session holds.
   */
  actions?: McpWriteActions;
  /** Called after a tool body has run and been audited. */
  onToolAudited?: () => void;
};

/** The outcome of a write action. `saved` carries the id of the rule or item that was written. */
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
  createRule: McpWriteAction;
  updateRule: McpWriteAction;
  createKnowledge: McpWriteAction;
  updateKnowledge: McpWriteAction;
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

function toKnowledgeView(item: KnowledgeItemRow, now: Date) {
  return {
    id: item.id,
    ruleId: item.ruleId,
    topic: item.topic,
    examples: item.examples,
    response: item.response,
    restrictions: item.restrictions,
    contacts: item.contacts,
    validFrom: item.validFrom?.toISOString() ?? null,
    validUntil: item.validUntil?.toISOString() ?? null,
    approvalStatus: item.approvalStatus,
    usable: isKnowledgeUsable(item, now),
  };
}

/**
 * A rule with its reply conditions, one entry for each channel. Each entry has the channel and the
 * settings of that channel at the same level, the shape that the rule tools accept.
 */
function toRuleView(
  rule: typeof autoReplyRules.$inferSelect,
  conditions: (typeof replyConditions.$inferSelect)[],
) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    timezone: rule.timezone,
    conditions: conditions.map((row) => ({ ...row.settings, channel: row.channel })),
  };
}

async function findOwnedRule(db: Db, userId: string, ruleId: string) {
  const [rule] = await db
    .select()
    .from(autoReplyRules)
    .where(and(eq(autoReplyRules.id, ruleId), eq(autoReplyRules.userId, userId)));

  return rule;
}

async function findOwnedItem(db: Db, userId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, itemId), eq(knowledgeItems.userId, userId)));

  return item;
}

const ruleIdArgs = z.object({ ruleId: z.uuid() });
const itemIdArgs = z.object({ itemId: z.uuid() });

const listKnowledgeArgs = z.object({
  ruleId: z.uuid().optional(),
  status: z.enum(["draft", "approved", "archived"]).optional(),
  usableOnly: z.boolean().optional(),
});

const searchKnowledgeArgs = z.object({ ruleId: z.uuid(), query: z.string().min(1).max(2000) });

type RunTool = (tool: string, body: () => Promise<ToolOutcome>) => Promise<CallToolResult>;

/**
 * The ids in the arguments of a write call. They are the only part of the arguments that is
 * audited, so a rule name or a knowledge text never reaches the log.
 */
function pickIds(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    ["ruleId", "itemId"].flatMap((key) => (args[key] === undefined ? [] : [[key, args[key]]])),
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

  if (holds("rules:read")) {
    server.registerTool(
      "list_rules",
      { description: "List the user's auto-reply rules.", inputSchema: z.object({}) },
      () =>
        run("list_rules", async () => {
          const rules = await db
            .select()
            .from(autoReplyRules)
            .where(eq(autoReplyRules.userId, session.userId))
            .orderBy(desc(autoReplyRules.createdAt));

          const conditions =
            rules.length === 0
              ? []
              : await db
                  .select()
                  .from(replyConditions)
                  .where(
                    inArray(
                      replyConditions.ruleId,
                      rules.map((rule) => rule.id),
                    ),
                  );

          return {
            outcome: "ok",
            data: {
              rules: rules.map((rule) =>
                toRuleView(
                  rule,
                  conditions.filter((row) => row.ruleId === rule.id),
                ),
              ),
            },
            summary: { count: rules.length },
          };
        }),
    );

    server.registerTool(
      "get_rule",
      { description: "Get one auto-reply rule of the user.", inputSchema: ruleIdArgs },
      ({ ruleId }) =>
        run("get_rule", async () => {
          const rule = await findOwnedRule(db, session.userId, ruleId);

          if (!rule) {
            return notFound({ ruleId });
          }

          const conditions = await db
            .select()
            .from(replyConditions)
            .where(eq(replyConditions.ruleId, ruleId));

          return { outcome: "ok", data: toRuleView(rule, conditions), summary: { ruleId } };
        }),
    );
  }

  if (holds("knowledge:read")) {
    server.registerTool(
      "list_knowledge",
      {
        description: "List the user's knowledge items, optionally for one rule or one status.",
        inputSchema: listKnowledgeArgs,
      },
      (args) =>
        run("list_knowledge", async () => {
          const now = clock();

          const rows = await db
            .select()
            .from(knowledgeItems)
            .where(
              and(
                eq(knowledgeItems.userId, session.userId),
                args.ruleId ? eq(knowledgeItems.ruleId, args.ruleId) : undefined,
                args.status ? eq(knowledgeItems.approvalStatus, args.status) : undefined,
              ),
            )
            .orderBy(desc(knowledgeItems.createdAt));

          const items = rows
            .map((row) => toKnowledgeView(row, now))
            .filter((view) => !args.usableOnly || view.usable);

          return { outcome: "ok", data: { items }, summary: { ...args, count: items.length } };
        }),
    );

    server.registerTool(
      "get_knowledge",
      { description: "Get one knowledge item of the user.", inputSchema: itemIdArgs },
      ({ itemId }) =>
        run("get_knowledge", async () => {
          const item = await findOwnedItem(db, session.userId, itemId);

          return item
            ? { outcome: "ok", data: toKnowledgeView(item, clock()), summary: { itemId } }
            : notFound({ itemId });
        }),
    );

    server.registerTool(
      "search_knowledge",
      {
        description:
          "Find the approved, currently valid knowledge items of one rule that match a text. Returns no matches when nothing is reliably close.",
        inputSchema: searchKnowledgeArgs,
      },
      ({ ruleId, query }) =>
        run("search_knowledge", async () => {
          const summary = { ruleId, queryLength: query.length };

          if (!deps.search) {
            return { outcome: "unavailable", message: "Search is not configured", summary };
          }

          if (!(await findOwnedRule(db, session.userId, ruleId))) {
            return notFound(summary);
          }

          const now = clock();

          const result = await searchKnowledge(
            { db, ...deps.search },
            { userId: session.userId, ruleId, text: query },
            { now },
          );

          if (result.status === "no_reliable_result") {
            return { outcome: "ok", data: { status: result.status, matches: [] }, summary };
          }

          return {
            outcome: "ok",
            data: {
              status: result.status,
              matches: result.matches.map((match) => ({
                score: match.score,
                item: toKnowledgeView(match.item, now),
              })),
            },
            summary: { ...summary, count: result.matches.length },
          };
        }),
    );

    server.registerResource(
      "knowledge-item",
      new ResourceTemplate("leren://knowledge/{id}", { list: undefined }),
      { description: "One knowledge item of the user, as JSON." },
      async (uri, variables) => {
        const id = String(variables.id);

        const item = z.uuid().safeParse(id).success
          ? await findOwnedItem(db, session.userId, id)
          : undefined;

        await writeAudit(db, session, "resource:knowledge", item ? "ok" : "not_found", {
          itemId: id,
        });

        if (!item) {
          throw new Error("Not found");
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(toKnowledgeView(item, clock())),
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "answer_from_knowledge",
      {
        description: "Guidance for answering a question only from the user's approved knowledge.",
        argsSchema: z.object({ ruleId: z.uuid(), question: z.string().min(1).max(2000) }),
      },
      ({ ruleId, question }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Call search_knowledge with ruleId "${ruleId}" to find knowledge for the question below.`,
                "Answer only from the returned items and respect their restrictions.",
                "If the search reports no reliable result, say that the knowledge does not cover it.",
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
      ["rules:write", "create_rule", deps.actions.createRule],
      ["rules:write", "update_rule", deps.actions.updateRule],
      ["knowledge:write", "create_knowledge", deps.actions.createKnowledge],
      ["knowledge:write", "update_knowledge", deps.actions.updateKnowledge],
    ] as const;

    for (const [scope, name, action] of writeTools) {
      if (holds(scope)) {
        registerWriteTool(server, name, action, run, session.userId);
      }
    }
  }

  return server;
}
