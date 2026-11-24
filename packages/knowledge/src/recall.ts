import { KNOWLEDGE_SEARCH_LIMIT, searchKnowledge } from "./search";
import type {
  KnowledgeSearchDependencies,
  KnowledgeSearchOptions,
  KnowledgeSearchQuery,
} from "./search";

/** A labelled retrieval case. */
export type RecallCase = {
  query: KnowledgeSearchQuery;
  relevantIds: string[];
};

export type RecallReport = {
  recall: number;
  cases: { query: string; recall: number; retrieved: string[] }[];
};

/** Computes recall among the first k retrieved ids. */
export function recallAtK(relevantIds: string[], retrievedIds: string[], k: number): number {
  if (relevantIds.length === 0) {
    return 1;
  }

  const topK = new Set(retrievedIds.slice(0, k));
  const found = relevantIds.filter((id) => topK.has(id)).length;

  return found / relevantIds.length;
}

/** Reports Recall@5 per case and as a mean. */
export async function measureRecall(
  dependencies: KnowledgeSearchDependencies,
  cases: RecallCase[],
  options: KnowledgeSearchOptions = {},
): Promise<RecallReport> {
  const reports: RecallReport["cases"] = [];

  for (const { query, relevantIds } of cases) {
    const result = await searchKnowledge(dependencies, query, options);

    const retrieved =
      result.status === "found" ? result.matches.map(({ playbook }) => playbook.id) : [];

    reports.push({
      query: query.text,
      recall: recallAtK(relevantIds, retrieved, KNOWLEDGE_SEARCH_LIMIT),
      retrieved,
    });
  }

  const total = reports.reduce((sum, report) => sum + report.recall, 0);

  return { recall: reports.length === 0 ? 1 : total / reports.length, cases: reports };
}
