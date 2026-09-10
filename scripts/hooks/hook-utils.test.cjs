"use strict";

const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  blockedDangerousPattern,
  commandText,
  editedPaths,
  findCompatibleNodeDirectory,
  minimumNodeVersion,
  normalizePath,
  requiresTest,
  testCandidates,
} = require("./hook-utils.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const HOOKS = __dirname;
const TEMP_PROJECTS = [];

after(() => {
  for (const root of TEMP_PROJECTS) fs.rmSync(root, { recursive: true, force: true });
});

function runHook(script, payload, root) {
  const result = runHookProcess(script, payload, root);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function runHookProcess(script, payload, root) {
  return spawnSync(process.execPath, [path.join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOOK_PROJECT_ROOT: root },
  });
}

function temporaryProject(packageJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-hooks-"));
  TEMP_PROJECTS.push(root);
  if (packageJson) fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
  return root;
}

test("normalizes absolute Windows and relative Unix paths", () => {
  assert.equal(normalizePath("C:\\ticket-mvp\\src\\lib\\seat-map.ts", "C:\\ticket-mvp"), "src/lib/seat-map.ts");
  assert.equal(normalizePath("./src/services/store.ts", ROOT), "src/services/store.ts");
});

test("accepts command strings and argv arrays", () => {
  assert.equal(commandText({ command: "npm test" }), "npm test");
  assert.equal(commandText({ command: ["git", "reset", "--hard"] }), "git reset --hard");
});

test("blocks the repository dangerous-command policy", () => {
  for (const command of ["rm -rf build", "git push --force", "git push --force-with-lease", "git reset --hard", "DROP TABLE seats"]) {
    assert.ok(blockedDangerousPattern(command), command);
  }
  assert.equal(blockedDangerousPattern("git push origin main"), undefined);
});

test("blocks additional dangerous patterns not caught by the original set", () => {
  for (const command of [
    "rm -r -f .",
    "git clean -fdx",
    "git clean -f",
    "rd /s /q C:\\build",
    "rmdir /s /q dist",
    "del /f /s /q *.log",
  ]) {
    assert.ok(blockedDangerousPattern(command), command);
  }
  assert.equal(blockedDangerousPattern("git status"), undefined);
});

test("extracts Add, Update, and Delete paths from apply_patch", () => {
  const patchText = [
    "*** Add File: src/lib/new.ts",
    "*** Update File: src/services/store.ts",
    "*** Delete File: src/app/api/holds/route.ts",
  ].join("\n");

  assert.deepEqual(editedPaths(patchText, ROOT), [
    "src/lib/new.ts",
    "src/services/store.ts",
    "src/app/api/holds/route.ts",
  ]);
});

test("requires tests only for lib, services, and API route implementations", () => {
  for (const file of [
    "src/lib/seat/map.ts",
    "src/services/memory/store.ts",
    "src/app/api/events/[eventId]/holds/route.ts",
  ]) assert.equal(requiresTest(file), true, file);

  for (const file of [
    "src/lib/seat/map.test.ts",
    "src/components/Seat.tsx",
    "src/atoms/seats.ts",
    "src/app/events/page.tsx",
    "src/types/seat.ts",
  ]) assert.equal(requiresTest(file), false, file);
});

test("lists colocated and __tests__ test candidates", () => {
  const candidates = testCandidates("src/lib/seat/map.ts", ROOT).map((candidate) => normalizePath(candidate, ROOT));
  assert.ok(candidates.includes("src/lib/seat/map.test.ts"));
  assert.ok(candidates.includes("src/lib/seat/map.spec.ts"));
  assert.ok(candidates.includes("src/lib/seat/__tests__/map.test.ts"));
  assert.ok(candidates.includes("src/lib/seat/__tests__/map.spec.ts"));
});

test("extracts the minimum Node version from the project engine range", () => {
  assert.deepEqual(minimumNodeVersion(">=22.0.0"), [22, 0, 0]);
  assert.deepEqual(minimumNodeVersion(">=22.12"), [22, 12, 0]);
  assert.equal(minimumNodeVersion("^22.0.0"), undefined);
});

test("selects a compatible Node directory later in PATH", () => {
  const versions = new Map([
    [path.posix.join("/old", "node"), "v20.11.1"],
    [path.posix.join("/current", "node"), "v22.22.3"],
  ]);
  const directory = findCompatibleNodeDirectory({
    pathValue: ["/old", "/current", "/old"].join(":"),
    minimumVersion: [22, 0, 0],
    platform: "darwin",
    fileExists: (file) => versions.has(file) || file.endsWith("/npm"),
    probeVersion: (file) => versions.get(file),
  });
  assert.equal(directory, "/current");
});

test("uses Windows executable names when selecting a compatible Node", () => {
  const directory = findCompatibleNodeDirectory({
    pathValue: "C:\\old;C:\\node22",
    minimumVersion: [22, 0, 0],
    platform: "win32",
    fileExists: (file) => file.endsWith("node.exe") || file.endsWith("npm.cmd"),
    probeVersion: (file) => file.includes("node22") ? "v22.1.0" : "v20.11.1",
  });
  assert.equal(directory, "C:\\node22");
});

test("returns no Node directory when PATH has no compatible runtime", () => {
  assert.equal(findCompatibleNodeDirectory({
    pathValue: "/old",
    minimumVersion: [22, 0, 0],
    platform: "darwin",
    fileExists: () => true,
    probeVersion: () => "v20.11.1",
  }), undefined);
});

test("dangerous-command hook denies argv commands", () => {
  const output = runHook("codex-block-dangerous.cjs", {
    tool_input: { command: ["git", "reset", "--hard"] },
  }, ROOT);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("TDD hook skips before package scaffolding", () => {
  const root = temporaryProject();
  assert.deepEqual(runHook("codex-tdd-guard.cjs", {
    tool_input: { file_path: "src/lib/rules.ts" },
  }, root), {});
});

test("TDD hook accepts a test and implementation in the same patch", () => {
  const root = temporaryProject({ private: true });
  const output = runHook("codex-tdd-guard.cjs", {
    tool_input: {
      command: [
        "*** Add File: src/lib/rules.test.ts",
        "*** Add File: src/lib/rules.ts",
      ].join("\n"),
    },
  }, root);
  assert.deepEqual(output, {});
});

test("TDD hook denies an implementation without a test", () => {
  const root = temporaryProject({ private: true });
  const output = runHook("codex-tdd-guard.cjs", {
    tool_input: { file_path: "src/services/store.ts" },
  }, root);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
});

test("verify hook skips before package scaffolding and on stop re-entry", () => {
  const emptyRoot = temporaryProject();
  assert.deepEqual(runHook("codex-verify-gate.cjs", {}, emptyRoot), { continue: true });

  const root = temporaryProject({ scripts: { lint: "exit 1", test: "exit 1" } });
  assert.deepEqual(runHook("codex-verify-gate.cjs", { stop_hook_active: true }, root), { continue: true });
});

test("verify hook blocks when lint or tests fail", () => {
  const root = temporaryProject({
    scripts: {
      lint: `${JSON.stringify(process.execPath)} -e \"process.exit(1)\"`,
      test: `${JSON.stringify(process.execPath)} -e \"process.exit(0)\"`,
    },
  });
  const output = runHook("codex-verify-gate.cjs", {}, root);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /npm run lint/);
});

test("Claude verify gate exits nonzero when lint or tests fail", () => {
  const root = temporaryProject({
    scripts: {
      lint: `${JSON.stringify(process.execPath)} -e \"process.exit(1)\"`,
      test: `${JSON.stringify(process.execPath)} -e \"process.exit(0)\"`,
    },
  });
  const result = runHookProcess("claude-verify-gate.cjs", {}, root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm run lint/);
});

test("Claude verify gate skips before scaffolding and on stop re-entry", () => {
  const emptyRoot = temporaryProject();
  assert.equal(runHookProcess("claude-verify-gate.cjs", {}, emptyRoot).status, 0);

  const root = temporaryProject({ scripts: { lint: "exit 1", test: "exit 1" } });
  assert.equal(runHookProcess("claude-verify-gate.cjs", { stop_hook_active: true }, root).status, 0);
});
