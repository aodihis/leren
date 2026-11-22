import { createFileRoute, notFound } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import { loadAccountsOrNone } from "../../../modules/channels/load-channel-accounts";
import { PlaybookForm } from "../../../modules/playbooks/components/playbook-form";

export const Route = createFileRoute("/_authed/playbooks/$playbookId")({
  loader: async ({ params }) => {
    const response = await api.api.playbooks[":id"].$get({ param: { id: params.playbookId } });

    if (response.status === 404) {
      throw notFound();
    }

    if (!response.ok) {
      throw new Error("Could not load the playbook.");
    }

    const { playbook } = await response.json();

    return { playbook, accounts: await loadAccountsOrNone() };
  },
  notFoundComponent: () => <p className="text-muted-foreground">This playbook does not exist.</p>,
  component: EditPlaybookPage,
});

function EditPlaybookPage() {
  const { playbook, accounts } = Route.useLoaderData();

  return <PlaybookForm key={playbook.id} playbook={playbook} accounts={accounts} />;
}
