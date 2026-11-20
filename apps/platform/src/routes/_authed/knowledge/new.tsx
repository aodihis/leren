import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeForm } from "../../../modules/knowledge-items/components/knowledge-form";
import { loadFormOptions } from "../../../modules/knowledge-items/load-options";

export const Route = createFileRoute("/_authed/knowledge/new")({
  loader: loadFormOptions,
  component: NewKnowledgePage,
});

function NewKnowledgePage() {
  const { rules, contacts } = Route.useLoaderData();

  return (
    <div className="space-y-4">
      <h1 className="mx-auto max-w-2xl text-2xl font-semibold">New knowledge item</h1>
      <KnowledgeForm rules={rules} contacts={contacts} />
    </div>
  );
}
