import { parseMessages } from "@anvia/core/completion";
import { initialMessagesFromMemory } from "@anvia/react";
import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";

import { api } from "../../../modules/api/api-client";
import { Conversation } from "../../../modules/assistant/components/conversation";

const authed = getRouteApi("/_authed");

export const Route = createFileRoute("/_authed/chat/$sessionId")({
  loader: async ({ params }) => {
    const response = await api.api.assistant.conversations[":sessionId"].$get({
      param: { sessionId: params.sessionId },
    });

    if (!response.ok) {
      throw new Error("Could not open this chat.");
    }

    const body = await response.json();

    return { messages: initialMessagesFromMemory(parseMessages(body.messages)) };
  },
  component: ChatPage,
});

/**
 * The assistant chat, filling the page. A conversation that does not exist yet is a new chat, so
 * the page for an unused id shows the welcome screen. The history in the sidebar reloads when a
 * run ends.
 */
function ChatPage() {
  const { sessionId } = Route.useParams();
  const { messages } = Route.useLoaderData();
  const { user } = authed.useRouteContext();
  const { available, conversations } = authed.useLoaderData();
  const router = useRouter();

  const title = conversations.find((conversation) => conversation.id === sessionId)?.title;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-header flex-none items-center border-b px-6">
        <h1 className="min-w-0 truncate text-title-sm font-semibold">{title ?? "New chat"}</h1>
      </header>
      <Conversation
        key={sessionId}
        id={sessionId}
        title={title}
        initialMessages={messages}
        available={available}
        userName={user.firstName || user.name || user.email}
        onRunEnd={() => void router.invalidate()}
      />
    </div>
  );
}
