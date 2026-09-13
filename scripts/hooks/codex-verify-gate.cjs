#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { emit, nodeEnvironmentForProject, readPayload } = require("./hook-utils.cjs");

const ROOT = process.env.HOOK_PROJECT_ROOT
  ? path.resolve(process.env.HOOK_PROJECT_ROOT)
  : path.resolve(__dirname, "..", "..");

/*
 * 150초는 실측 스위트 시간(158초)보다 짧아 test가 매번 죽고 실패로 보고됐다.
 * 테스트 파일이 늘어나는 것을 감안해 상한을 올린다. 무한 대기를 막는 것이
 * 목적이지 스위트 시간을 강제하는 것이 목적이 아니다.
 */
const NPM_SCRIPT_TIMEOUT_MS = 300_000;

function runNpm(script, env) {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(executable, ["run", script], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: NPM_SCRIPT_TIMEOUT_MS,
  });
}

readPayload((payload) => {
  if (payload.stop_hook_active || !fs.existsSync(path.join(ROOT, "package.json"))) {
    emit({ continue: true });
    return;
  }

  const runtime = nodeEnvironmentForProject(ROOT);
  if (runtime.error) {
    emit({ decision: "block", reason: runtime.error });
    return;
  }

  const failures = [];
  for (const script of ["lint", "test"]) {
    const result = runNpm(script, runtime.env);
    if (result.status !== 0) {
      const output = `${result.stdout || ""}\n${result.stderr || result.error || ""}`.trim();
      failures.push(`npm run ${script} 실패:\n${output.slice(-3000)}`);
    }
  }

  emit(failures.length === 0
    ? { continue: true }
    : { decision: "block", reason: failures.join("\n\n") });
});
