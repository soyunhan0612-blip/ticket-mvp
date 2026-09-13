import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CORE_DIRECTORY = resolve(process.cwd(), "src/chatbot/core");
const ALLOWED_PACKAGE_IMPORTS = new Set([
  "@anthropic-ai/sdk",
  "@anthropic-ai/sdk/helpers/beta/zod",
  "zod",
]);

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return listSourceFiles(path);
    if (extname(entry.name) !== ".ts") return [];
    if (/\.(?:test|spec)\.ts$/.test(entry.name)) return [];

    return [path];
  });
}

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

describe("chatbot core import boundary", () => {
  it("allows only portable SDK packages and same-directory relative imports", () => {
    const violations = listSourceFiles(CORE_DIRECTORY).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");

      return listImportSpecifiers(source)
        .filter(
          (specifier) =>
            !ALLOWED_PACKAGE_IMPORTS.has(specifier) &&
            !specifier.startsWith("./"),
        )
        .map(
          (specifier) =>
            `${relative(process.cwd(), filePath)} imports ${specifier}`,
        );
    });

    expect(violations).toEqual([]);
  });
});
