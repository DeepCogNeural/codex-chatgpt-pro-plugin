import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CdpSession, now, sleep } from "../src/cdp-client.mjs";
import { newChatGptSession } from "../src/chatgpt-sessions.mjs";
import { acquireChatGptOperation } from "../src/chatgpt-operation.mjs";
import { uploadProjectSourceFiles } from "../src/chatgpt-project-source.mjs";
import {
  defaultUploadLedgerPath,
  projectSourceUploadScopeKey,
} from "../src/chatgpt-upload.mjs";
import { writeJson } from "../src/observe.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import {
  DEFAULT_CDP_PORT,
  runDir as makeRunDir,
  runId as makeRunId,
} from "../src/runtime-config.mjs";
import { configuredChatGptProjectUrl } from "../src/git-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function args(name) {
  const prefix = `--${name}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  throw error;
}

const command = process.argv[2] || "upload";
const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const projectUrl = arg("project-url")
  || arg("chatgpt-project-url")
  || process.env.CHATGPT_PROJECT_URL
  || configuredChatGptProjectUrl()
  || "";
const sourceFiles = [
  ...args("source-file"),
  ...args("upload-file"),
  ...String(process.env.CHATGPT_PROJECT_SOURCE_FILES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const noWaitForLock = flag("no-wait");
const runId = `${makeRunId()}-chatgpt-project-source`;
const runDir = makeRunDir(runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const project = ensureProjectState();
const started = now();

let cdp = null;
let operationHandle = null;
const receipt = {
  loop: "chatgpt-project-source",
  command,
  project,
  chatGptProject: {
    url: projectUrl || null,
  },
  sourceFiles,
  startedAt: new Date().toISOString(),
  runDir,
};

try {
  if (command === "create") {
    fail(
      "project_source.create_project_not_implemented",
      "Creating a new ChatGPT Project is not automated yet. Create the Project once in ChatGPT, then rerun project-source upload with --project-url=<project URL>.",
    );
  }
  if (command !== "upload") {
    fail("project_source.command_unsupported", "Supported commands: upload, create.", { command });
  }
  if (!projectUrl) {
    fail(
      "project_source.project_url_required",
      "Project source upload requires --project-url=<ChatGPT Project URL>, CHATGPT_PROJECT_URL, or repo-local git config chatgpt-pro.projectUrl.",
    );
  }
  if (!sourceFiles.length) {
    fail("project_source.files_required", "Provide at least one --source-file=<path>.");
  }
  if (!flag("confirm-project-source-upload")) {
    fail(
      "project_source.confirmation_required",
      "Project source upload can persist files into ChatGPT Project knowledge. Re-run with --confirm-project-source-upload after checking the files are safe to upload.",
      { sourceFiles },
    );
  }

  operationHandle = await acquireChatGptOperation({
    name: "project-source.upload",
    kind: "live-browser",
    runId,
    alias: "project-source",
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    noWait: noWaitForLock,
    staleLockTtlMs,
  });
  Object.assign(receipt, operationHandle.receipt());
  receipt.owner = receipt.locks.browser.owner;
  receipt.lock = receipt.locks.browser.receipt;

  const target = await newChatGptSession(port, { name: null, url: projectUrl, bind: false });
  cdp = await CdpSession.open(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");
  receipt.sessionTarget = {
    targetId: target.id,
    title: target.title,
    url: target.url,
  };
  await sleep(Number(process.env.CHATGPT_PROJECT_SOURCE_SETTLE_MS || 5_000));

  receipt.upload = await uploadProjectSourceFiles(cdp, sourceFiles, {
    stageDir: resolve(runDir, "project-source-uploads"),
    ledgerPath: defaultUploadLedgerPath,
    scopeKey: projectSourceUploadScopeKey({
      projectId: project.projectId,
      projectUrl,
    }),
  });
  receipt.ok = true;
  receipt.completedAt = new Date().toISOString();
  receipt.totalMs = Math.round(now() - started);
} catch (error) {
  receipt.ok = false;
  receipt.completedAt = new Date().toISOString();
  receipt.errorCode = error?.errorCode || "project_source.failed";
  receipt.error = String(error?.message || error);
  receipt.failure = error?.details || undefined;
  receipt.totalMs = Math.round(now() - started);
  if (error?.details?.owner && !receipt.owner) receipt.owner = error.details.owner;
  if (error?.details?.lock && !receipt.lock) receipt.lock = error.details.lock;
  if (error?.details?.operation && !receipt.operation) receipt.operation = error.details.operation;
  if (error?.details?.locks && !receipt.locks) receipt.locks = error.details.locks;
} finally {
  if (cdp) await cdp.close().catch(() => {});
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
  writeJson(resolve(runDir, "receipt.json"), receipt);
}

console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.ok ? 0 : 1);
