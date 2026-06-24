import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  RECEIVED_HEADING,
  SEND_STATUS_UNKNOWN_HEADING,
  SENT_HEADING,
  UNSENT_HEADING,
  renderChatGptTranscript,
  renderReceivedEcho,
  shouldPrintThreadEcho,
} from "../transcript.mjs";

export function sha256Text(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function fileSha256(path) {
  return sha256Text(readFileSync(path, "utf8"));
}

function artifactPath(runDir, file) {
  return resolve(runDir, file);
}

export function renderEnvelopeTranscript({
  kind = "call",
  sentMarkdown = "",
  receivedMarkdown = "",
  sentToChatGpt = true,
  sendStatus = "",
} = {}) {
  if (kind === "read") return renderReceivedEcho({ receivedMarkdown });
  return renderChatGptTranscript({ sentMarkdown, receivedMarkdown, sentToChatGpt, sendStatus });
}

export function threadEchoMode(env = process.env) {
  return shouldPrintThreadEcho(env) ? "enabled" : "disabled_by_env";
}

export function sealRunEnvelope({
  kind = "call",
  runDir,
  receipt,
  sentMarkdown = "",
  receivedMarkdown = "",
  sentToChatGpt = true,
  sendStatus = "",
  stdoutRendered = shouldPrintThreadEcho(),
} = {}) {
  if (!runDir) throw new Error("runDir is required to seal a ChatGPT run envelope.");
  if (!receipt) throw new Error("receipt is required to seal a ChatGPT run envelope.");

  const effectiveSendStatus = kind === "read"
    ? null
    : sendStatus || (sentToChatGpt ? "sent_verified" : "not_sent");
  const transcriptMarkdown = renderEnvelopeTranscript({
    kind,
    sentMarkdown,
    receivedMarkdown,
    sentToChatGpt,
    sendStatus: effectiveSendStatus || "",
  });
  const transcriptPath = artifactPath(runDir, "transcript.md");
  writeFileSync(transcriptPath, transcriptMarkdown, { mode: 0o600 });

  const promptPath = artifactPath(runDir, "prompt.md");
  const inputPath = artifactPath(runDir, "input.md");
  const assistantPath = artifactPath(runDir, "assistant.md");
  const receiptPath = artifactPath(runDir, "receipt.json");

  const artifacts = {
    ...(receipt.artifacts || {}),
    receipt: receiptPath,
    transcript: transcriptPath,
  };
  if (existsSync(inputPath)) artifacts.input = inputPath;
  if (existsSync(promptPath)) artifacts.prompt = promptPath;
  if (existsSync(assistantPath)) artifacts.assistant = assistantPath;

  const artifactHashes = {
    ...(receipt.artifactHashes || {}),
    transcriptSha256: sha256Text(transcriptMarkdown),
  };
  if (existsSync(inputPath)) artifactHashes.inputSha256 = fileSha256(inputPath);
  if (existsSync(promptPath)) artifactHashes.promptSha256 = fileSha256(promptPath);
  if (existsSync(assistantPath)) artifactHashes.assistantSha256 = fileSha256(assistantPath);

  const mode = stdoutRendered ? "enabled" : "disabled_by_env";
  const threadEcho = {
    mode,
    stdoutRendered: Boolean(stdoutRendered),
    requiredForInteractive: true,
    contract: "agent_must_paste_verbatim",
    enforcement: stdoutRendered ? "stdout_rendered_not_verified" : "disabled_by_env",
    sendStatus: effectiveSendStatus,
    sentToChatGpt: effectiveSendStatus === "sent_verified"
      ? true
      : effectiveSendStatus === "not_sent"
        ? false
        : null,
    transcriptSha256: artifactHashes.transcriptSha256,
    sentSha256: sha256Text(sentMarkdown),
    receivedSha256: sha256Text(receivedMarkdown),
  };

  Object.assign(receipt, {
    kind,
    threadEcho,
    artifactHashes,
    artifacts,
  });

  return {
    kind,
    transcriptMarkdown,
    transcriptPath,
    artifacts,
    artifactHashes,
    threadEcho,
  };
}

export function verifyRunEnvelope({ receiptPath } = {}) {
  if (!receiptPath) throw new Error("Provide --receipt=<path>.");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const runDir = receipt.runDir || dirname(resolve(receiptPath));
  const kind = receipt.kind || receipt.loop?.replace(/^chatgpt-/, "") || "call";
  const artifacts = receipt.artifacts || {};
  const promptPath = artifacts.prompt || artifactPath(runDir, "prompt.md");
  const assistantPath = artifacts.assistant || artifactPath(runDir, "assistant.md");
  const transcriptPath = artifacts.transcript || artifactPath(runDir, "transcript.md");

  if (!existsSync(transcriptPath)) {
    const error = new Error(`Missing transcript artifact: ${transcriptPath}`);
    error.errorCode = "transcript.missing";
    throw error;
  }
  const transcriptMarkdown = readFileSync(transcriptPath, "utf8");
  if (!transcriptMarkdown.includes(`## ${RECEIVED_HEADING}`)) {
    const error = new Error(`Transcript missing heading: ## ${RECEIVED_HEADING}`);
    error.errorCode = "transcript.heading_missing";
    throw error;
  }
  const sendStatus = kind === "read"
    ? null
    : receipt.threadEcho?.sendStatus || (receipt.threadEcho?.sentToChatGpt === false ? "not_sent" : "sent_verified");
  const sentToChatGpt = kind === "read"
    ? null
    : sendStatus === "sent_verified";
  const expectedSentHeading = sendStatus === "not_sent"
    ? UNSENT_HEADING
    : sendStatus === "send_status_unknown"
      ? SEND_STATUS_UNKNOWN_HEADING
      : SENT_HEADING;
  if (kind !== "read" && !transcriptMarkdown.includes(`## ${expectedSentHeading}`)) {
    const error = new Error(`Transcript missing heading: ## ${expectedSentHeading}`);
    error.errorCode = "transcript.heading_missing";
    throw error;
  }

  const sentMarkdown = existsSync(promptPath) ? readFileSync(promptPath, "utf8") : "";
  const receivedMarkdown = existsSync(assistantPath) ? readFileSync(assistantPath, "utf8") : "";
  const expected = renderEnvelopeTranscript({
    kind: kind === "read" ? "read" : "call",
    sentMarkdown,
    receivedMarkdown,
    sentToChatGpt: sentToChatGpt !== false,
    sendStatus: sendStatus || "",
  });
  if (transcriptMarkdown !== expected) {
    const error = new Error("Transcript content does not match the canonical renderer.");
    error.errorCode = "transcript.renderer_mismatch";
    throw error;
  }

  const actual = {
    transcriptSha256: sha256Text(transcriptMarkdown),
    sentSha256: sha256Text(sentMarkdown),
    receivedSha256: sha256Text(receivedMarkdown),
  };
  const threadEcho = receipt.threadEcho || {};
  for (const [key, value] of Object.entries(actual)) {
    if (threadEcho[key] && threadEcho[key] !== value) {
      const error = new Error(`Receipt threadEcho.${key} does not match artifacts.`);
      error.errorCode = "transcript.hash_mismatch";
      error.details = { key, expected: threadEcho[key], actual: value };
      throw error;
    }
  }

  return {
    ok: true,
    receiptPath,
    transcriptPath,
    kind,
    threadEcho: {
      ...threadEcho,
      ...actual,
    },
  };
}
