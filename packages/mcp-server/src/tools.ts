import { autoReplyRules, knowledgeItems, knowledgeProposals } from "@leren/db";
import type { Db } from "@leren/db";
import { isKnowledgeUsable, searchKnowledge } from "@leren/knowledge";
import type { KnowledgeItemRow, KnowledgeSearchDependencies } from "@leren/knowledge";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { and, desc, eq } from "drizzle-orm";
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
  /** Called after a tool body has run and been audited. */
  onToolAudited?: () => void;
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

function toRuleView(rule: typeof autoReplyRules.$inferSelect) {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    startsAt: rule.startsAt?.toISOString() ?? null,
    endsAt: rule.endsAt?.toISOString() ?? null,
    timezone: rule.timezone,
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

const proposeKnowledgeEditArgs = z.object({
  ruleId: z.uuid(),
  itemId: z.uuid().optional(),
  idempotencyKey: z.string().min(1).max(200),
  topic: z.string().min(1).max(200).optional(),
  response: z.string().min(1).max(10_000).optional(),
  examples: z.array(z.string().min(1).max(500)).max(20).optional(),
  restrictions: z.string().max(5000).optional(),
  contacts: z.array(z.string().min(1).max(200)).max(20).optional(),
});

type ProposeKnowledgeEditArgs = z.infer<typeof proposeKnowledgeEditArgs>;

/**
 * Builds the MCP server of one request for one verified session. A tool, resource or prompt is
 * registered only when the session holds its scope, so a call outside the granted scopes is
 * rejected as an unknown name. The user is the session's user, and no tool takes a user id.
 * Every call that reaches a tool body writes an audit row, and the endpoint audits the calls that
 * the SDK rejects first. The one tool that changes data only records a proposal.
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

          return {
            outcome: "ok",
            data: { rules: rules.map(toRuleView) },
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

          return rule
            ? { outcome: "ok", data: toRuleView(rule), summary: { ruleId } }
            : notFound({ ruleId });
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

  if (holds("knowledge:propose")) {
    server.registerTool(
      "propose_knowledge_edit",
      {
        description:
          "Suggest a new knowledge item, or a change to an existing one. The suggestion is saved for the user to review and changes nothing until the user accepts it. Repeating a call with the same idempotencyKey returns the first proposal.",
        inputSchema: proposeKnowledgeEditArgs,
      },
      (args) => run("propose_knowledge_edit", () => proposeKnowledgeEdit(db, session, args)),
    );
  }

  return server;
}

/**
 * Saves a proposal without touching `knowledge_items`. The rule, and the item when one is named,
 * must belong to the session's user. The unique key on the session and the idempotency key makes
 * a repeated call return the first proposal.
 */
async function proposeKnowledgeEdit(
  db: Db,
  session: McpSession,
  args: ProposeKnowledgeEditArgs,
): Promise<ToolOutcome> {
  const { ruleId, itemId, idempotencyKey, ...fields } = args;
  const summary = { ruleId, itemId: itemId ?? null, idempotencyKey };

  if (!(await findOwnedRule(db, session.userId, ruleId))) {
    return notFound(summary);
  }

  if (itemId) {
    const item = await findOwnedItem(db, session.userId, itemId);

    if (!item || item.ruleId !== ruleId) {
      return notFound(summary);
    }
  }

  const proposal = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(proposal).length === 0) {
    return { outcome: "invalid", message: "Propose at least one field", summary };
  }

  if (!itemId && (!proposal.topic || !proposal.response)) {
    return { outcome: "invalid", message: "A new item needs a topic and a response", summary };
  }

  await db
    .insert(knowledgeProposals)
    .values({
      userId: session.userId,
      sessionId: session.id,
      ruleId,
      itemId: itemId ?? null,
      idempotencyKey,
      proposal,
    })
    .onConflictDoNothing();

  const [saved] = await db
    .select()
    .from(knowledgeProposals)
    .where(
      and(
        eq(knowledgeProposals.sessionId, session.id),
        eq(knowledgeProposals.idempotencyKey, idempotencyKey),
        eq(knowledgeProposals.userId, session.userId),
      ),
    );

  return {
    outcome: "ok",
    data: { proposalId: saved.id, status: saved.status },
    summary: { ...summary, proposalId: saved.id },
  };
}
