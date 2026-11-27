import type { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { collectPlaybooks } from "./playbooks";

const playbook = { id: "p1", topic: "Deadline", information: "Friday.", usable: true };

const searchText = JSON.stringify({
  outcome: "ok",
  data: { status: "ok", matches: [{ score: 0.8, playbook }] },
});

/** The messages of a run in which one tool returned `value`. */
function resultOf(value: unknown, toolName = "search_playbooks"): Message[] {
  return [
    { role: "user", content: "Question" },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName,
          output: { type: "json", value: value as never },
        },
      ],
    },
  ];
}

const ids = (messages: Message[]) => collectPlaybooks(messages).map((entry) => entry.id);

describe("collectPlaybooks", () => {
  it("returns the playbooks that tools returned during a run", () => {
    const messages: Message[] = [
      { role: "user", content: "Question" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "search_playbooks",
            output: { type: "text", value: searchText },
          },
        ],
      },
    ];

    expect(ids(messages)).toEqual(["p1"]);
  });

  it("finds a playbook inside wrapped, serialized tool output", () => {
    expect(ids(resultOf({ content: [{ type: "text", text: searchText }] }))).toEqual(["p1"]);
  });

  it("reads the shape that the MCP server returns for a search", () => {
    const text = JSON.stringify({ status: "ok", matches: [{ score: 0.8, playbook }] });

    expect(ids(resultOf({ content: [{ type: "text", text }] }))).toEqual(["p1"]);
  });

  it("skips a playbook that is not usable and repeats of the same id", () => {
    expect(ids(resultOf([playbook, playbook, { ...playbook, id: "p2", usable: false }]))).toEqual([
      "p1",
    ]);
  });

  it("returns nothing for text that is not JSON", () => {
    expect(ids(resultOf("Unauthorized"))).toEqual([]);
  });

  it("ignores the results of tools that are not playbook tools", () => {
    expect(ids(resultOf(JSON.parse(searchText), "web_search"))).toEqual([]);
  });
});
