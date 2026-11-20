import { createFileRoute, notFound } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import { RuleForm } from "../../../modules/auto-reply-rules/components/rule-form";

export const Route = createFileRoute("/_authed/auto-reply-rules/$ruleId")({
  loader: async ({ params }) => {
    const response = await api.api["auto-reply-rules"][":id"].$get({
      param: { id: params.ruleId },
    });

    if (response.status === 404) {
      throw notFound();
    }

    if (!response.ok) {
      throw new Error("Could not load the rule.");
    }

    const { rule } = await response.json();

    return rule;
  },
  notFoundComponent: () => <p className="text-muted-foreground">This rule does not exist.</p>,
  component: EditRulePage,
});

function EditRulePage() {
  const rule = Route.useLoaderData();

  return (
    <div className="space-y-4">
      <h1 className="mx-auto max-w-2xl text-2xl font-semibold">Edit {rule.name}</h1>
      <RuleForm key={rule.id} rule={rule} />
    </div>
  );
}
