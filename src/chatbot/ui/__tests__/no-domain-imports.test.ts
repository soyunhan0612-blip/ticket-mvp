import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const USE_CHAT_PATH = resolve(process.cwd(), "src/chatbot/ui/use-chat.ts");
const ALLOWED_PACKAGE_IMPORTS = new Set([
  "react",
  "@tanstack/react-query",
]);

function listImportSpecifiers(source: string): string[] {
  const fromImports = Array.from(
    source.matchAll(/\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s*["']([^"']+)["']/g),
    (match) => match[1],
  );
  const sideEffectImports = Array.from(
    source.matchAll(/\bimport\s*["']([^"']+)["']/g),
    (match) => match[1],
  );

  return [...fromImports, ...sideEffectImports];
}

describe("portable useChat import boundary", () => {
  it("allows only portable UI packages and same-directory relative imports", () => {
    const source = readFileSync(USE_CHAT_PATH, "utf8");
    const violations = listImportSpecifiers(source)
      .filter(
        (specifier) =>
          !ALLOWED_PACKAGE_IMPORTS.has(specifier) &&
          !specifier.startsWith("./"),
      )
      .map(
        (specifier) =>
          `${relative(process.cwd(), USE_CHAT_PATH)} imports ${specifier}`,
      );

    expect(violations).toEqual([]);
  });
});
