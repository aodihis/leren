import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <h1 className="text-2xl font-semibold">Welcome to Leren</h1>,
});
