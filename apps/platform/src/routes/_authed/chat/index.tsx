import { createFileRoute, redirect } from "@tanstack/react-router";

/** Starts a new chat. */
export const Route = createFileRoute("/_authed/chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/chat/$sessionId", params: { sessionId: crypto.randomUUID() } });
  },
});
