import { createFileRoute } from "@tanstack/react-router";

import { PlaybookForm } from "../../../modules/playbooks/components/playbook-form";

export const Route = createFileRoute("/_authed/playbooks/new")({
  component: () => (
    <div className="space-y-4">
      <h1 className="mx-auto max-w-2xl text-2xl font-semibold">New playbook</h1>
      <PlaybookForm />
    </div>
  ),
});
