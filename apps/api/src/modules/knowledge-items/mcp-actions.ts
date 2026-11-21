import type { Db } from "@leren/db";
import type { McpWriteActions, McpWriteOutcome } from "@leren/mcp-server";
import { z } from "zod";

import { NOTHING_TO_CHANGE, definedOnly, invalid } from "../../mcp-write";
import { knowledgeItemSchema } from "./schema";
import { createItem, getItem, updateItem } from "./service";
import type { KnowledgeResult } from "./service";

const instant = z.iso.datetime({ offset: true });

const knowledgeFields = z.object({
  topic: z.string().describe("The subject of the item, up to 200 characters."),
  response: z.string().describe("What may be said about the subject, up to 5000 characters."),
  examples: z.array(z.string()).optional().describe("Sample incoming messages."),
  restrictions: z.string().optional().describe("What must not be said."),
  contacts: z.array(z.string()).optional().describe("Email addresses or handles to point to."),
  validFrom: instant.nullable().optional().describe("When the item becomes valid."),
  validUntil: instant.nullable().optional().describe("When the item stops being valid."),
});

const createKnowledgeArgs = knowledgeFields.extend({ ruleId: z.uuid() });
const updateKnowledgeArgs = knowledgeFields.partial().extend({ itemId: z.uuid() });

/**
 * Converts the result of creating or replacing an item. Those two operations never report a status
 * conflict, which only the approval actions do.
 */
function fromKnowledgeResult(result: KnowledgeResult): McpWriteOutcome {
  switch (result.status) {
    case "saved":
      return { status: "saved", id: result.item.id, data: result.item };
    case "invalid":
      return { status: "invalid", message: Object.values(result.fieldErrors).flat().join("; ") };
    default:
      return { status: "not_found" };
  }
}

/**
 * Builds the tools that let the Assistant Agent create and change knowledge on behalf of the
 * session's user. Each tool validates the complete result with the same schema as the web API and
 * calls the same service, so an item saved here is the same as one saved in the interface. An item
 * is saved as a draft, or returned to draft when it was approved, because only the user approves
 * knowledge. `requestIndex` asks for the vector index of a written item to be updated, as the web
 * API does.
 */
export function createKnowledgeMcpActions(
  db: Db,
  requestIndex: (itemId: string) => Promise<void>,
): Pick<McpWriteActions, "createKnowledge" | "updateKnowledge"> {
  return {
    createKnowledge: {
      description:
        "Create a knowledge item for one of the user's rules. It is saved as a draft that the user approves in the interface. Call it only after the user has confirmed the exact text.",
      inputSchema: createKnowledgeArgs,
      async run(userId, input: z.infer<typeof createKnowledgeArgs>) {
        const parsed = knowledgeItemSchema.safeParse({
          examples: [],
          restrictions: "",
          contacts: [],
          validFrom: null,
          validUntil: null,
          ...definedOnly(input),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const result = await createItem(db, userId, parsed.data);

        if (result.status === "saved") {
          await requestIndex(result.item.id);
        }

        return fromKnowledgeResult(result);
      },
    },
    updateKnowledge: {
      description:
        "Change an existing knowledge item of the user. Name only the fields to change. An approved item returns to draft and the user approves it again. Call it only after the user has confirmed the exact text.",
      inputSchema: updateKnowledgeArgs,
      async run(userId, input: z.infer<typeof updateKnowledgeArgs>) {
        const { itemId, ...changes } = input;

        if (Object.keys(definedOnly(changes)).length === 0) {
          return NOTHING_TO_CHANGE;
        }

        const existing = await getItem(db, userId, itemId);

        if (!existing) {
          return { status: "not_found" };
        }

        const parsed = knowledgeItemSchema.safeParse({
          ruleId: existing.ruleId,
          topic: existing.topic,
          response: existing.response,
          examples: existing.examples,
          restrictions: existing.restrictions,
          contacts: existing.contacts,
          validFrom: existing.validFrom,
          validUntil: existing.validUntil,
          ...definedOnly(changes),
        });

        if (!parsed.success) {
          return invalid(parsed.error);
        }

        const result = await updateItem(db, userId, itemId, parsed.data);

        if (result.status === "saved") {
          await requestIndex(result.item.id);
        }

        return fromKnowledgeResult(result);
      },
    },
  };
}
