import type { Message } from "@anvia/core";
import { describe, expect, it } from "vitest";
import { collectPlaybooks, parseSearchResult, readPlaybooks } from "./search-result";

const playbook = { id: "p1", topic: "Deadline", response: "Friday.", usable: true };

const searchText = JSON.stringify({
  outcome: "ok",
  data: { status: "ok", matches: [{ score: 0.8, playbook }] },
});

describe("readPlaybooks", () => {
  it("finds a playbook inside wrapped, serialized tool output", () => {
    const output = { content: [{ type: "text", text: searchText }] };

    expect(readPlaybooks(output).map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("reads the shape that the MCP server returns for a search", () => {
    const output = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "ok", matches: [{ score: 0.8, playbook }] }),
        },
      ],
    };

    expect(readPlaybooks(output).map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("skips a playbook that is not usable and repeats of the same id", () => {
    const output = [playbook, playbook, { ...playbook, id: "p2", usable: false }];

    expect(readPlaybooks(output).map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("returns nothing for text that is not JSON", () => {
    expect(readPlaybooks("Unauthorized")).toEqual([]);
  });
});

describe("parseSearchResult", () => {
  it("reads an answer without a playbook as no reliable result", () => {
    expect(parseSearchResult({ status: "no_reliable_result", matches: [] })).toEqual({
      status: "no_reliable_result",
    });
    expect(parseSearchResult(null)).toEqual({ status: "no_reliable_result" });
  });
});

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

    expect(collectPlaybooks(messages).map((entry) => entry.id)).toEqual(["p1"]);
  });

  it("ignores the results of tools that are not playbook tools", () => {
    const messages: Message[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "web_search",
            output: { type: "text", value: searchText },
          },
        ],
      },
    ];

    expect(collectPlaybooks(messages)).toEqual([]);
  });
});
