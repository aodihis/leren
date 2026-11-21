import { createHttpClientTransport } from "@anvia/client";
import type { ClientStreamEvent, UIMessage } from "@anvia/client";
import { useChat } from "@anvia/react";
import { Alert, AlertDescription, Button, Textarea } from "@leren/ui";
import { SendIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

const SUGGESTIONS = ["What rules do I have?", "Help me add knowledge to a rule"];
const WRITE_TOOL = /(^|_)(create|update)_(rule|knowledge)$/;
const TITLE_LENGTH = 60;
const MAX_MESSAGE_LENGTH = 4000;

function titleFrom(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();

  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

function textOf(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

interface ConversationProps {
  /** The id of the conversation, which is the agent's memory session. */
  id: string;
  /** The title that was stored with an existing conversation. */
  title: string | undefined;
  initialMessages: readonly UIMessage[];
  /** Whether the server has an assistant to talk to. */
  available: boolean;
  /** Called after the assistant has created or changed a rule or knowledge item. */
  onSaved: () => void;
  /** Called when a run ends, so that the history list can show the conversation. */
  onRunEnd: () => void;
}

/**
 * One conversation of the assistant chat, driven by Anvia's `useChat` over the chat endpoint.
 * Mount it with a new `key` for each conversation, because the hook reads its initial messages
 * once. The assistant asks for confirmation in the conversation before it changes anything, so the
 * user's answer is an ordinary message.
 */
export function Conversation({
  id,
  title,
  initialMessages,
  available,
  onSaved,
  onRunEnd,
}: ConversationProps) {
  const transport = useMemo(
    () => createHttpClientTransport({ endpoint: `/api/assistant/chat?sessionId=${id}` }),
    [id],
  );

  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  function handleEvent(event: ClientStreamEvent) {
    if (event.type === "tool_result" && WRITE_TOOL.test(event.toolName)) {
      onSaved();
    } else if (event.type === "run_end") {
      onRunEnd();
    }
  }

  const chat = useChat({ transport, initialMessages, onEvent: handleEvent });
  const working = chat.status === "submitted" || chat.status === "streaming";
  const canSend = available && !working;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.messages]);

  async function submit(message: string) {
    const text = message.trim();

    if (!text || !canSend) {
      return;
    }

    const first = chat.messages.find((item) => item.role === "user");

    setDraft("");
    await chat.sendMessage({
      text,
      metadata: { title: title ?? titleFrom(first ? textOf(first) : text) },
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit(draft);
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!available && (
          <Alert>
            <AlertDescription>
              The assistant is not available right now. You can still manage everything on this
              page.
            </AlertDescription>
          </Alert>
        )}
        {available && chat.messages.length === 0 && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-body-sm text-ink-muted">
              Ask about your rules and knowledge, or have the assistant set them up. It asks for
              your confirmation before it saves anything.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  disabled={!canSend}
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {working && (
          <p role="status" className="text-body-sm text-ink-muted">
            The assistant is working…
          </p>
        )}
        {chat.error && (
          <Alert variant="destructive">
            <AlertDescription>
              The assistant could not finish. Try again in a moment.
            </AlertDescription>
          </Alert>
        )}
        <div ref={endRef} />
      </div>

      <footer className="flex-none space-y-2 border-t p-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <Textarea
            aria-label="Message"
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            value={draft}
            disabled={!available}
            placeholder="Ask or add knowledge…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-0 flex-1 resize-none"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!canSend || !draft.trim()}>
            <SendIcon strokeWidth={1.75} />
          </Button>
        </form>
        <p className="text-center text-caption text-ink-muted">
          Nothing is saved without your confirmation
        </p>
      </footer>
    </>
  );
}

function Message({ message }: { message: UIMessage }) {
  const text = textOf(message);

  if (!text || (message.role !== "user" && message.role !== "assistant")) {
    return null;
  }

  if (message.role === "user") {
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-subtle px-3 py-2 text-sm whitespace-pre-wrap">
        {text}
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <span
        className="grid size-6 flex-none place-items-center rounded-full bg-brand-soft text-brand"
        aria-hidden="true"
      >
        <SparklesIcon className="size-3.5" strokeWidth={1.75} />
      </span>
      <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}
