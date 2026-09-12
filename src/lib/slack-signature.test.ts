import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifySlackSignature } from "@/lib/slack-signature";

const SIGNING_SECRET = "test-signing-secret";
const RAW_BODY = '{"type":"event_callback","event":{"text":"안녕하세요"}}';
const NOW = 1_760_000_000_000;
const CURRENT_TIMESTAMP = String(NOW / 1000);

function createSlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
): string {
  const digest = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");

  return `v0=${digest}`;
}

function verify(overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) {
  return verifySlackSignature({
    signingSecret: SIGNING_SECRET,
    timestamp: CURRENT_TIMESTAMP,
    signature: createSlackSignature(
      SIGNING_SECRET,
      CURRENT_TIMESTAMP,
      RAW_BODY,
    ),
    rawBody: RAW_BODY,
    now: NOW,
    ...overrides,
  });
}

describe("verifySlackSignature", () => {
  it("accepts a valid signature with a recent timestamp", () => {
    expect(verify()).toBe(true);
  });

  it("rejects a signature when the raw body changes by one character", () => {
    expect(verify({ rawBody: `${RAW_BODY} ` })).toBe(false);
  });

  it("rejects a signature created with a different signing secret", () => {
    expect(
      verify({
        signature: createSlackSignature(
          "different-signing-secret",
          CURRENT_TIMESTAMP,
          RAW_BODY,
        ),
      }),
    ).toBe(false);
  });

  it.each([
    ["six minutes old", NOW - 360_000],
    ["six minutes in the future", NOW + 360_000],
  ])("rejects a timestamp that is %s", (_label, timestampMs) => {
    const timestamp = String(timestampMs / 1000);

    expect(
      verify({
        timestamp,
        signature: createSlackSignature(SIGNING_SECRET, timestamp, RAW_BODY),
      }),
    ).toBe(false);
  });

  it("rejects a non-integer timestamp", () => {
    expect(verify({ timestamp: "abc" })).toBe(false);
  });

  it.each(["", "   "])("rejects an empty signing secret (%j)", (signingSecret) => {
    expect(
      verify({
        signingSecret,
        signature: createSlackSignature(
          signingSecret,
          CURRENT_TIMESTAMP,
          RAW_BODY,
        ),
      }),
    ).toBe(false);
  });

  it.each(["v0=короткий", ""])(
    "rejects a differently sized signature without throwing (%j)",
    (signature) => {
      expect(verify({ signature })).toBe(false);
    },
  );
});
