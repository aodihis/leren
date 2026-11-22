import { cn } from "@leren/ui";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";

import { api } from "../../api/api-client";
import type { ConversationSummary } from "../types";

interface ChatHistoryProps {
  conversations: readonly ConversationSummary[];
  /** The id of the conversation that is open, if any. */
  activeId: string | undefined;
  onNavigate?: () => void;
}

/**
 * The user's earlier conversations, newest first, for the sidebar. The open conversation is shown
 * in bold on a subtle background and no navigation item is highlighted with it. Deleting the open
 * conversation starts a new one.
 */
export function ChatHistory({ conversations, activeId, onNavigate }: ChatHistoryProps) {
  const router = useRouter();
  const navigate = useNavigate();

  async function remove(id: string) {
    try {
      await api.api.assistant.conversations[":sessionId"].$delete({ param: { sessionId: id } });
    } finally {
      await router.invalidate();
    }

    if (id === activeId) {
      await navigate({ to: "/chat" });
    }
  }

  return (
    <section aria-label="Chats" className="flex min-h-0 flex-1 flex-col max-lg:md:hidden">
      <h2 className="px-5 pt-4 pb-1 text-label font-semibold tracking-wide text-ink-muted uppercase">
        Chats
      </h2>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
        {conversations.length === 0 && (
          <li className="px-2.5 py-1.5 text-body-sm text-ink-muted">No chats yet</li>
        )}
        {conversations.map((conversation) => (
          <li key={conversation.id} className="group relative">
            <Link
              to="/chat/$sessionId"
              params={{ sessionId: conversation.id }}
              onClick={onNavigate}
              aria-current={conversation.id === activeId ? "page" : undefined}
              className={cn(
                "block truncate rounded-md py-1.5 pr-8 pl-2.5 text-sm text-ink-muted outline-none",
                "hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-ring",
                conversation.id === activeId && "bg-subtle font-semibold text-ink",
              )}
            >
              {conversation.title}
            </Link>
            <button
              type="button"
              aria-label={`Delete chat ${conversation.title}`}
              onClick={() => void remove(conversation.id)}
              className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 rounded p-1 text-ink-muted group-focus-within:block group-hover:block hover:text-danger"
            >
              <Trash2Icon className="size-3.5" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
