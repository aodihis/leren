import { createHttpClientTransport } from "@anvia/client";
import type { UIMessage } from "@anvia/client";
import { useChat } from "@anvia/react";
import { Alert, AlertDescription, Button, Textarea } from "@leren/ui";
import { ArrowUpIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";

const STARTERS = [
  { label: "See my rules", prompt: "What rules do I have?" },
  { label: "Add knowledge", prompt: "Help me add knowledge to a rule" },
  { label: "Set up a rule", prompt: "Help me create an auto-reply rule" },
];

const TITLE_LENGTH = 60;
const MAX_MESSAGE_LENGTH = 4000;

function titleFrom(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();

  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

/** Styles for the elements of an assistant reply. */
const MARKDOWN_COMPONENTS: Components = {
  p: ({ node: _node, ...props }) => <p className="whitespace-pre-wrap" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="list-disc space-y-1.5 pl-6" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="list-decimal space-y-1.5 pl-6" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      className="text-brand underline underline-offset-2"
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  code: ({ node: _node, ...props }) => (
    <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[0.9em]" {...props} />
  ),
};

function textOf(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

interface ConversationProps {
  /** The id of the conversation. */
  id: string;
  /** The stored title of an existing conversation. */
  title: string | undefined;
  initialMessages: readonly UIMessage[];
  /** Whether the server has an assistant to talk to. */
  available: boolean;
  /** The name the welcome screen greets. */
  userName: string;
  /** Called when a run ends. */
  onRunEnd: () => void;
}

/** One conversation of the assistant chat. */
export function Conversation({
  id,
  title,
  initialMessages,
  available,
  userName,
  onRunEnd,
}: ConversationProps) {
  const transport = useMemo(
    () => createHttpClientTransport({ endpoint: `/api/assistant/chat?sessionId=${id}` }),
    [id],
  );

  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const chat = useChat({
    transport,
    initialMessages,
    onEvent: (event) => {
      if (event.type === "run_end") {
        onRunEnd();
      }
    },
  });

  const working = chat.status === "submitted" || chat.status === "streaming";
  const canSend = available && !working;
  const empty = chat.messages.length === 0;
  const last = chat.messages.at(-1);
  const lastPart = last?.parts.at(-1);
  const answering = last?.role === "assistant" && lastPart?.type === "text" && lastPart.text !== "";

  useEffect(() => {
    if (chat.messages.length === 0) {
      return;
    }

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

  const composer = (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border bg-surface p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring"
    >
      <Textarea
        aria-label="Message"
        rows={empty ? 3 : 2}
        maxLength={MAX_MESSAGE_LENGTH}
        value={draft}
        disabled={!available}
        placeholder="Ask about your rules or add knowledge…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <p className="text-label text-ink-muted">Nothing is saved without your confirmation</p>
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={!canSend || !draft.trim()}
          className="rounded-full"
        >
          <ArrowUpIcon strokeWidth={2} />
        </Button>
      </div>
    </form>
  );

  const unavailable = !available && (
    <Alert>
      <AlertDescription>
        The assistant is not available right now. You can still manage everything in Playbooks.
      </AlertDescription>
    </Alert>
  );

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-chat-reading space-y-6">
          <div className="space-y-2 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
              <SparklesIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h2 className="text-title-lg font-semibold">Hello, {userName}</h2>
            <p className="text-body text-ink-muted">
              Ask about your rules and knowledge, or have the assistant set them up. It asks for
              your confirmation before it saves anything.
            </p>
          </div>
          {unavailable}
          {composer}
          <div className="grid gap-2 sm:grid-cols-3">
            {STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                disabled={!canSend}
                onClick={() => void submit(starter.prompt)}
                className="rounded-xl border bg-surface p-3 text-left text-sm font-medium outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {starter.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-chat-reading space-y-6 px-6 py-6">
          {chat.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          {working && !answering && (
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
          {unavailable}
          <div ref={endRef} />
        </div>
      </div>
      <div className="flex-none px-6 pb-4">
        <div className="mx-auto w-full max-w-chat-reading">{composer}</div>
      </div>
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
      <div className="ml-auto w-fit max-w-[70%] rounded-2xl bg-subtle px-4 py-2.5 text-title-sm whitespace-pre-wrap">
        {text}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 text-title-sm">
      <Markdown components={MARKDOWN_COMPONENTS}>{text}</Markdown>
    </div>
  );
}
