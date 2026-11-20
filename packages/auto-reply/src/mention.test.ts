import { describe, expect, it } from "vitest";

import { detectMention } from "./mention";

describe("detectMention", () => {
  it.each([
    ["Hi Iqbal, can you report the status?", ["Iqbal"], true],
    ["hi IQBAL, status?", ["Iqbal"], true],
    ["Thanks, Iqbal.", ["Iqbal"], true],
    ["Hi all, what about the project?", ["Iqbal"], false],
    ["The annual report is due.", ["Ann"], false],
    ["Hi Bal, status?", ["Iqbal", "Bal"], true],
    ["Hi José, status?", ["José"], true],
    ["Hi Josée, status?", ["José"], false],
    ["Question about C++ (see Dr. X)", ["Dr. X", "C++"], true],
    ["Hi Iqbal", ["", "  "], false],
    ["Hi Iqbal", [], false],
  ] as const)("matches %j against %j: %s", (body, names, expected) => {
    expect(detectMention(body, names)).toBe(expected);
  });
});
