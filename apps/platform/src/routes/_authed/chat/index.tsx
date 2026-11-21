import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Starts a new chat. The id of a conversation is chosen here and lives in the URL, so a new chat
 * has an address before its first message and a reload keeps it.
 */
export const Route = createFileRoute("/_authed/chat/")({
  beforeLoad: () => {
    throw redirect({ to: "/chat/$sessionId", params: { sessionId: crypto.randomUUID() } });
  },
});
