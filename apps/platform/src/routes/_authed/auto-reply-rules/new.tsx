import { createFileRoute } from "@tanstack/react-router";

import { RuleForm } from "../../../modules/auto-reply-rules/components/rule-form";

export const Route = createFileRoute("/_authed/auto-reply-rules/new")({
  component: () => (
    <div className="space-y-4">
      <h1 className="mx-auto max-w-2xl text-2xl font-semibold">New auto-reply rule</h1>
      <RuleForm />
    </div>
  ),
});
