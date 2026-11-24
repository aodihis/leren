import { EvalOutcome, createEvalTypes, runEvalCli } from "@anvia/core/evals";
import type { EvalTarget } from "@anvia/core/evals";
import { playbooks, users } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import { createEmbedder } from "@leren/embedder";
import {
  KNOWLEDGE_COLLECTION,
  KNOWLEDGE_SEARCH_LIMIT,
  recallAtK,
  searchKnowledge,
  toEmbeddingText,
  toVectorMetadata,
} from "@leren/knowledge";
import { createVectorStore } from "@leren/vector-db";
import type { VectorStore } from "@leren/vector-db";
import { resolveEmbeddingModel } from "@leren/agents";
import harness from "../../../../harness.config";
import { NOT_APPLICABLE, applyGate } from "./gate";
import type { Thresholds } from "./gate";
import { corpus, recallCases } from "./recall-cases";
import type { RecallExpectation, RecallInput } from "./recall-cases";
import { reporters } from "./target";

const QDRANT_URL = process.env.VECTOR_STORE_URL ?? "http://localhost:16333";
const COLLECTION = `knowledge_eval_${crypto.randomUUID().replaceAll("-", "")}`;

/** The output of one retrieval case. */
type RecallOutput = { status: "found" | "no_reliable_result"; retrieved: readonly string[] };

const { defineMetric } = createEvalTypes<RecallInput, RecallOutput, RecallExpectation>();

const rename = (collection: string) =>
  collection === KNOWLEDGE_COLLECTION ? COLLECTION : collection;

/** Redirects the knowledge collection for this run. */
function isolateCollection(store: VectorStore): VectorStore {
  return {
    ensureCollection: (config) => store.ensureCollection({ ...config, name: rename(config.name) }),
    upsert: (collection, records) => store.upsert(rename(collection), records),
    search: (query) => store.search({ ...query, collection: rename(query.collection) }),
    delete: (collection, ids) => store.delete(rename(collection), ids),
    list: (collection) => store.list(rename(collection)),
    deleteCollection: (collection) => store.deleteCollection(rename(collection)),
  };
}

const embeddingModel = resolveEmbeddingModel(harness);

const embedder = createEmbedder({
  baseUrl: embeddingModel.definition.baseUrl,
  apiKey: embeddingModel.apiKey,
  model: embeddingModel.definition.modelId,
  dimensions: embeddingModel.definition.dimensions,
});

const store = isolateCollection(createVectorStore({ url: QDRANT_URL }));
const database = await createTestDatabase();
const keyById = new Map<string, string>();

/** Inserts and indexes the corpus for a new user. */
async function indexCorpus(): Promise<string> {
  const [user] = await database.db
    .insert(users)
    .values({ email: `${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });

  await store.ensureCollection({ name: KNOWLEDGE_COLLECTION, dimensions: embedder.dimensions });

  for (const entry of corpus) {
    const [row] = await database.db
      .insert(playbooks)
      .values({
        userId: user.id,
        timezone: "UTC",
        topic: entry.topic,
        examples: entry.examples,
        response: entry.response,
      })
      .returning();

    keyById.set(row.id, entry.key);

    await store.upsert(KNOWLEDGE_COLLECTION, [
      {
        id: row.id,
        vector: (await embedder.embed([toEmbeddingText(row)]))[0],
        metadata: toVectorMetadata(row),
      },
    ]);
  }

  return user.id;
}

/** Builds the eval target over the corpus. */
function createTarget(userId: string): EvalTarget<RecallInput, RecallOutput> {
  return async (input, _testCase, context) => {
    const result = await searchKnowledge(
      { db: database.db, store, embedder },
      { userId, text: input.text },
      { signal: context?.signal },
    );

    if (result.status === "no_reliable_result") {
      return { status: result.status, retrieved: [] };
    }

    return {
      status: "found",
      retrieved: result.matches.map(({ playbook }) => keyById.get(playbook.id) ?? playbook.id),
    };
  };
}

/** Passes when relevant playbooks rank top five. */
const recall = defineMetric({
  name: "recall-at-5",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    const relevant = [...(testCase.expected?.relevant ?? [])];

    if (relevant.length === 0) {
      return EvalOutcome.pass(true, { comment: NOT_APPLICABLE });
    }

    const score = recallAtK(relevant, [...output.retrieved], KNOWLEDGE_SEARCH_LIMIT);

    return score === 1
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Recall@5 ${score.toFixed(2)}. Wanted [${relevant.join(", ")}], got [${output.retrieved.join(", ")}]`,
        });
  },
});

/** Passes when an unanswerable query finds nothing. */
const abstains = defineMetric({
  name: "abstains-without-knowledge",
  dataType: "BOOLEAN",
  evaluate({ case: testCase, output }) {
    if ((testCase.expected?.relevant ?? []).length > 0) {
      return EvalOutcome.pass(true, { comment: NOT_APPLICABLE });
    }

    return output.status === "no_reliable_result"
      ? EvalOutcome.pass(true)
      : EvalOutcome.fail(false, {
          comment: `Found [${output.retrieved.join(", ")}] for a query without a relevant playbook`,
        });
  },
});

/** The quality gate of the retrieval suite. */
const thresholds: Thresholds = {
  "recall-at-5": 0.9,
  "abstains-without-knowledge": 0.75,
};

try {
  const userId = await indexCorpus();

  const result = await runEvalCli({
    name: "recall",
    cases: recallCases,
    target: createTarget(userId),
    reporters,
    concurrency: 1,
    metrics: [recall, abstains],
  });

  const relevantById = new Map<string, string[]>(
    recallCases.map((testCase) => [testCase.id, [...testCase.expected.relevant]]),
  );

  const scores = result.results.flatMap((entry) => {
    const relevant = relevantById.get(entry.case.id) ?? [];

    return relevant.length === 0 || !entry.output
      ? []
      : [recallAtK(relevant, [...entry.output.retrieved], KNOWLEDGE_SEARCH_LIMIT)];
  });

  const mean = scores.reduce((sum, score) => sum + score, 0) / Math.max(scores.length, 1);

  console.log(
    `\nMean Recall@${KNOWLEDGE_SEARCH_LIMIT}: ${mean.toFixed(3)} over ${scores.length} cases`,
  );

  applyGate(result, thresholds);
} finally {
  await store.deleteCollection(KNOWLEDGE_COLLECTION);
  await database.drop();
}
