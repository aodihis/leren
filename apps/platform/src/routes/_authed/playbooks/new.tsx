import { createFileRoute } from "@tanstack/react-router";

import { loadAccountsOrNone } from "../../../modules/channels/load-channel-accounts";
import { PlaybookForm } from "../../../modules/playbooks/components/playbook-form";

export const Route = createFileRoute("/_authed/playbooks/new")({
  loader: loadAccountsOrNone,
  component: NewPlaybookPage,
});

function NewPlaybookPage() {
  const accounts = Route.useLoaderData();

  return <PlaybookForm accounts={accounts} />;
}
