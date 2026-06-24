import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-help-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-help-home-"));

function runHelp(...args) {
  return spawnSync(process.execPath, [resolve("bin/chatgpt-pro"), ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 3_000,
    env: {
      ...process.env,
      CHATGPT_PRO_HOME: home,
      CHROME_REMOTE_DEBUGGING_PORT: "1",
      CHATGPT_LOCK_TIMEOUT_MS: "1",
      CHATGPT_RESPONSE_TIMEOUT_MS: "1",
    },
  });
}

try {
  const readHelp = runHelp("read", "--help");
  assert.equal(readHelp.status, 0, readHelp.stderr || readHelp.stdout);
  assert.equal(readHelp.signal, null);
  assert.match(readHelp.stdout, /Usage: chatgpt-pro read/);
  assert.match(readHelp.stdout, /same --alias and --task-id/);
  assert.doesNotMatch(readHelp.stdout, /chatgpt-read-current/);
  assert.equal(existsSync(resolve(repo, ".devspace", "runs")), false);
  assert.equal(existsSync(resolve(home, "locks", "browser-profile.lock")), false);

  const callHelp = runHelp("call", "--help");
  assert.equal(callHelp.status, 0, callHelp.stderr || callHelp.stdout);
  assert.match(callHelp.stdout, /Usage: chatgpt-pro call/);
  assert.match(callHelp.stdout, /Do not resend/);

  const historyHelp = runHelp("history", "read", "--help");
  assert.equal(historyHelp.status, 0, historyHelp.stderr || historyHelp.stdout);
  assert.match(historyHelp.stdout, /Usage: chatgpt-pro history/);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "cli-help" }, null, 2));
