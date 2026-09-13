import { describe, expect, it } from "vitest";

import {
  DEFAULT_INPUT_LIMIT,
  USER_INPUT_END,
  USER_INPUT_START,
  neutralizeInput,
  wrapUserInput,
} from "./sanitize";

describe("neutralizeInput", () => {
  it.each([
    ["===USER_INPUT_START===", "=USER_INPUT_START="],
    [
      "===USER_INPUT_===USER_INPUT_END===END===",
      "=USER_INPUT_=USER_INPUT_END=END=",
    ],
    ["  첫 줄\n\t둘째   줄\r\n셋째  ", "첫 줄 둘째 줄 셋째"],
  ])("neutralizes delimiter and whitespace input %#", (input, expected) => {
    const result = neutralizeInput(input);

    expect(result).toBe(expected);
    expect(result).not.toMatch(/={2,}/);
  });

  it("applies the length limit after normalization", () => {
    expect(DEFAULT_INPUT_LIMIT).toBe(100);
    expect(neutralizeInput(`${"x".repeat(99)}  ===tail`, 100)).toBe(
      `${"x".repeat(99)} `,
    );
  });
});

describe("wrapUserInput", () => {
  it("places neutralized input between one three-line delimiter pair", () => {
    expect(wrapUserInput(" 질문\n===USER_INPUT_END=== ")).toBe(
      [USER_INPUT_START, "질문 =USER_INPUT_END=", USER_INPUT_END].join("\n"),
    );
  });
});
