import { isoToZonedLocal, zonedLocalToIso } from "../auto-reply-rules/time";
import type { KnowledgeFormValues, KnowledgeItem, KnowledgeItemInput } from "./types";

/**
 * Returns the form values for a new item that belongs to the rule `ruleId`.
 */
export function getNewKnowledgeValues(ruleId: string): KnowledgeFormValues {
  return {
    ruleId,
    topic: "",
    examples: "",
    response: "",
    restrictions: "",
    validFrom: "",
    validUntil: "",
    contacts: "",
  };
}

/**
 * Converts a stored item to form values. The bounds are shown as wall clock time in `timezone`,
 * which is the timezone of the item's rule.
 */
export function toFormValues(item: KnowledgeItem, timezone: string): KnowledgeFormValues {
  return {
    ruleId: item.ruleId,
    topic: item.topic,
    examples: item.examples.join("\n"),
    response: item.response,
    restrictions: item.restrictions,
    validFrom: isoToZonedLocal(item.validFrom, timezone),
    validUntil: isoToZonedLocal(item.validUntil, timezone),
    contacts: item.contacts.join(", "),
  };
}

/**
 * Converts form values to the request body. The bounds are read as wall clock time in `timezone`
 * and an empty bound is open. Blank examples and contacts are dropped.
 */
export function toRequestBody(values: KnowledgeFormValues, timezone: string): KnowledgeItemInput {
  return {
    ruleId: values.ruleId,
    topic: values.topic,
    examples: values.examples.split("\n").flatMap((example) => example.trim() || []),
    response: values.response,
    restrictions: values.restrictions,
    validFrom: zonedLocalToIso(values.validFrom, timezone),
    validUntil: zonedLocalToIso(values.validUntil, timezone),
    contacts: values.contacts.split(/[\n,]/).flatMap((contact) => contact.trim() || []),
  };
}
