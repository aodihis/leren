import { initialMessagesFromMemory } from "@anvia/react";
import type { UIMessage } from "@anvia/client";
import { parseMessages } from "@anvia/core/completion";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@leren/ui";
import { HistoryIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../api/api-client";
import type { ConversationSummary } from "../types";
import { Conversation } from "./conversation";

interface OpenConversation {
  id: string;
  messages: readonly UIMessage[];
}

function startConversation(): OpenConversation {
  return { id: crypto.randomUUID(), messages: [] };
}

interface ChatPanelProps {
  /** Called after the assistant has saved a change, so that the page can reload its data. */
  onSaved: () => void;
  /** Called when the user closes the panel. */
  onClose: () => void;
}

/**
 * The assistant chat docked beside the rules and knowledge screens. It lists earlier
 * conversations, opens one of them or starts a new one, and delegates a conversation to
 * `Conversation`. The screens work without the assistant, so an unavailable assistant only
 * disables the composer.
 */
export function ChatPanel({ onSaved, onClose }: ChatPanelProps) {
  const [available, setAvailable] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [open, setOpen] = useState<OpenConversation>(startConversation);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const response = await api.api.assistant.$get();

      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const body = await loadHistory();

    if (body) {
      setAvailable(body.available);
      setConversations(body.conversations);
    }
  }, [loadHistory]);

  useEffect(() => {
    let active = true;

    void loadHistory().then((body) => {
      if (active && body) {
        setAvailable(body.available);
        setConversations(body.conversations);
      }
    });

    return () => {
      active = false;
    };
  }, [loadHistory]);

  async function openConversation(id: string) {
    try {
      const response = await api.api.assistant.conversations[":sessionId"].$get({
        param: { sessionId: id },
      });

      if (!response.ok) {
        setLoadFailed(true);

        return;
      }

      const body = await response.json();

      setLoadFailed(false);
      setOpen({ id, messages: initialMessagesFromMemory(parseMessages(body.messages)) });
    } catch {
      setLoadFailed(true);
    }
  }

  async function removeConversation(id: string) {
    try {
      const response = await api.api.assistant.conversations[":sessionId"].$delete({
        param: { sessionId: id },
      });

      if (response.ok && id === open.id) {
        setOpen(startConversation());
      }
    } catch {
      setLoadFailed(true);
    }

    await refreshHistory();
  }

  const title = conversations.find((conversation) => conversation.id === open.id)?.title;

  return (
    <section aria-label="Assistant" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex h-header flex-none items-center gap-1 border-b px-4">
        <h2 className="min-w-0 flex-1 truncate text-title-sm font-semibold">
          {title ?? "Assistant"}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Chat history">
              <HistoryIcon strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Chats</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {conversations.length === 0 && (
              <p className="px-2 py-1.5 text-body-sm text-ink-muted">No chats yet</p>
            )}
            {conversations.map((conversation) => (
              <DropdownMenuItem
                key={conversation.id}
                onSelect={() => void openConversation(conversation.id)}
                className="justify-between gap-2"
              >
                <span className="truncate">{conversation.title}</span>
                <button
                  type="button"
                  aria-label={`Delete chat ${conversation.title}`}
                  className="flex-none rounded p-1 text-ink-muted hover:text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeConversation(conversation.id);
                  }}
                >
                  <Trash2Icon className="size-3.5" strokeWidth={1.75} />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          aria-label="New chat"
          onClick={() => {
            setLoadFailed(false);
            setOpen(startConversation());
          }}
        >
          <PlusIcon strokeWidth={1.75} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close assistant" onClick={onClose}>
          <XIcon strokeWidth={1.75} />
        </Button>
      </header>
      {loadFailed && (
        <p role="alert" className="px-4 pt-3 text-body-sm text-danger">
          Could not open that chat.
        </p>
      )}
      <Conversation
        key={open.id}
        id={open.id}
        initialMessages={open.messages}
        title={title}
        available={available}
        onSaved={onSaved}
        onRunEnd={() => void refreshHistory()}
      />
    </section>
  );
}
