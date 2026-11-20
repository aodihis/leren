import { createFileRoute, notFound } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import { KnowledgeForm } from "../../../modules/knowledge-items/components/knowledge-form";
import { loadFormOptions } from "../../../modules/knowledge-items/load-options";

export const Route = createFileRoute("/_authed/knowledge/$itemId")({
  loader: async ({ params }) => {
    const [response, options] = await Promise.all([
      api.api["knowledge-items"][":id"].$get({ param: { id: params.itemId } }),
      loadFormOptions(),
    ]);

    if (response.status === 404) {
      throw notFound();
    }

    if (!response.ok) {
      throw new Error("Could not load the item.");
    }

    const { item } = await response.json();

    return { item, ...options };
  },
  notFoundComponent: () => <p className="text-muted-foreground">This item does not exist.</p>,
  component: EditKnowledgePage,
});

function EditKnowledgePage() {
  const { item, rules, contacts } = Route.useLoaderData();

  return (
    <div className="space-y-4">
      <h1 className="mx-auto max-w-2xl text-2xl font-semibold">Edit {item.topic}</h1>
      <KnowledgeForm key={item.id} item={item} rules={rules} contacts={contacts} />
    </div>
  );
}
