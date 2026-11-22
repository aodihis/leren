# Sources and further reading

Found while researching this skill. Read the originals before changing the guidance here.

- Anthropic Engineering, "Demystifying evals for AI agents":
  https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents. Covers code-based,
  model-based and human graders, capability evals against regression evals, and grading what the
  agent produced instead of the path it took. The search excerpts did not show a passage on
  positive and negative cases, so the "balanced problem set" advice here follows the article's
  guidance on balanced problem sets. Check the article itself for its exact wording.
- Arize, "Tips from Anthropic on building agent evals you can trust":
  https://arize.com/blog/anthropic-tips-how-to-build-evals-you-can-trust/. A summary of the article
  above. It notes that a passing result can come from real capability, a flawed test or luck, so an
  eval must give enough evidence to tell them apart.
- Study notes on the article: https://snowan.gitbook.io/study-notes/ai/ai-resources-1/evals/anthropic-demisfy-ai-evals.
  Lists clear and unambiguous tasks, balanced problem sets and graders that are not brittle.
- RAG triad of faithfulness, answer relevance and context relevance, from a book chapter on
  retrieval-augmented generation evaluation:
  https://www.manning.com/preview/retrieval-augmented-generation-the-foundational-ideas/chapter-14
- Faithfulness and contextual relevancy compared, and RAGAS-style claim-by-claim faithfulness
  (decompose the answer into claims, then check each against the context):
  https://arxiv.org/pdf/2510.25621 and https://web3.arxiv.org/pdf/2506.20128
- Judge-model limits such as circularity, shared bias and lower agreement on faithfulness than on
  relevancy, and non-LLM alternatives such as entailment models:
  https://arxiv.org/pdf/2505.16483

Not verified: the exact wording of each source beyond the search excerpts. Only the points above
were taken from them.
