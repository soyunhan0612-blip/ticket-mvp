import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = resolve(process.cwd(), "src");
const EXPECTED_CALLER = "src/app/api/chat/slack/events/route.ts";

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function toProjectPath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

describe("ConversationStore appendOperatorReply callers", () => {
  it("keeps the unsigned-user write path limited to the Slack callback route", () => {
    const callers = listTypeScriptFiles(SOURCE_DIRECTORY)
      .map(toProjectPath)
      .filter((path) => !/\.(?:test|spec)\.tsx?$/.test(path))
      .filter((path) => !/^src\/services\/conversation-store(?:-[^/]+)?\.ts$/.test(path))
      .filter((path) => (
        readFileSync(resolve(process.cwd(), path), "utf8")
          .includes("appendOperatorReply")
      ));

    // appendOperatorReply intentionally has no userId ownership check. Every
    // additional caller would create another ownership-bypass write path.
    expect(callers).toEqual([EXPECTED_CALLER]);
  });
});
