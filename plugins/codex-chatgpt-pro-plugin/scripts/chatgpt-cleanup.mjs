import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { acquireChatGptOperation } from "../src/chatgpt-operation.mjs";
import { cleanupDuplicateUploadModals } from "../src/chatgpt-cleanup.mjs";
import { writeJson } from "../src/observe.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import {
  runDir as makeRunDir,
  runId as makeRunId,
} from "../src/runtime-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const command = process.argv[2] || "duplicate-upload";
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const noWaitForLock = flag("no-wait");
const runId = `${makeRunId()}-chatgpt-cleanup`;
const runDir = makeRunDir(runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const project = ensureProjectState();

let operationHandle = null;
const receipt = {
  loop: "chatgpt-cleanup",
  command,
  project,
  startedAt: new Date().toISOString(),
  runDir,
};

try {
  if (command !== "duplicate-upload") {
    const error = new Error("Supported cleanup commands: duplicate-upload.");
    error.errorCode = "cleanup.command_unsupported";
    throw error;
  }

  operationHandle = await acquireChatGptOperation({
    name: "cleanup.duplicate-upload",
    kind: "live-browser",
    runId,
    alias: "cleanup",
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    noWait: noWaitForLock,
    staleLockTtlMs,
  });
  Object.assign(receipt, operationHandle.receipt());
  receipt.owner = receipt.locks.browser.owner;
  receipt.lock = receipt.locks.browser.receipt;

  receipt.cleanup = await cleanupDuplicateUploadModals();
  receipt.ok = true;
  receipt.completedAt = new Date().toISOString();
} catch (error) {
  receipt.ok = false;
  receipt.completedAt = new Date().toISOString();
  receipt.errorCode = error?.errorCode || "cleanup.failed";
  receipt.error = String(error?.message || error);
  receipt.failure = error?.details || undefined;
  if (error?.details?.owner && !receipt.owner) receipt.owner = error.details.owner;
  if (error?.details?.lock && !receipt.lock) receipt.lock = error.details.lock;
  if (error?.details?.operation && !receipt.operation) receipt.operation = error.details.operation;
  if (error?.details?.locks && !receipt.locks) receipt.locks = error.details.locks;
} finally {
  if (operationHandle) {
    try {
      Object.assign(receipt, await operationHandle.release());
      receipt.lock = receipt.locks.browser.receipt;
    } catch (error) {
      receipt.lockReleaseFailure = String(error?.message || error);
    } finally {
      operationHandle = null;
    }
  }
  receipt.artifacts = {
    receipt: resolve(runDir, "receipt.json"),
  };
  writeJson(resolve(runDir, "receipt.json"), receipt);
}

console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.ok ? 0 : 1);
