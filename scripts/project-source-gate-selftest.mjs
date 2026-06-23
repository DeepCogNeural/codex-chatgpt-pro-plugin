import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  PROJECT_SOURCE_INPUT_CANDIDATE_SELECTOR,
  PROJECT_SOURCE_TARGET_ATTR,
} from "../src/chatgpt-project-source.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-project-source-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-project-source-home-"));
const source = resolve(repo, "background.md");

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_PRO_HOME: home,
      CHROME_REMOTE_DEBUGGING_PORT: "9",
    },
  });
}

try {
  mkdirSync(repo, { recursive: true });
  writeFileSync(source, "# Background\n");

  const create = run(["project-source", "create", "--project-url=https://chatgpt.com/g/project"]);
  assert.notEqual(create.status, 0);
  assert.equal(JSON.parse(create.stdout).errorCode, "project_source.create_project_not_implemented");

  const missingConfirm = run([
    "project-source",
    "upload",
    "--project-url=https://chatgpt.com/g/project",
    `--source-file=${source}`,
  ]);
  assert.notEqual(missingConfirm.status, 0);
  assert.equal(JSON.parse(missingConfirm.stdout).errorCode, "project_source.confirmation_required");

  const missingFile = run([
    "project-source",
    "upload",
    "--project-url=https://chatgpt.com/g/project",
    "--confirm-project-source-upload",
  ]);
  assert.notEqual(missingFile.status, 0);
  assert.equal(JSON.parse(missingFile.stdout).errorCode, "project_source.files_required");

  const projectSourceModule = readFileSync(resolve(packageRoot, "src", "chatgpt-project-source.mjs"), "utf8");
  assert.equal(PROJECT_SOURCE_INPUT_CANDIDATE_SELECTOR, "input[type='file']:not(#upload-files)");
  assert.equal(PROJECT_SOURCE_TARGET_ATTR, "data-codex-project-source-target");
  assert.doesNotMatch(projectSourceModule, /document\.querySelector(All)?\(["']input\[type=['"]file['"]\]["']\)/);
  assert.doesNotMatch(projectSourceModule, /"input\[type='file'\]",/);
  assert.match(projectSourceModule, /composerForm\.contains/);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "project-source-gate" }, null, 2));
