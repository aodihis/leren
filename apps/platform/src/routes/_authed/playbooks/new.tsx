import { createFileRoute } from "@tanstack/react-router";

import { PlaybookForm } from "../../../modules/playbooks/components/playbook-form";

export const Route = createFileRoute("/_authed/playbooks/new")({
  component: PlaybookForm,
});
