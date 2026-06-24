import { existsSync, readFileSync } from "node:fs";

function looksLikeCallRun(entry = {}) {
  return /chatgpt-call/.test(String(entry.runId || ""))
    || /chatgpt-call/.test(String(entry.receiptPath || ""));
}

function anchorError(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function readReceipt(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function latestCallAnchorFromRoom(room = {}, {
  exists = existsSync,
  readJson = readReceipt,
} = {}) {
  const entries = [
    room.lastReceiptPath ? {
      runId: room.lastRunId || "",
      receiptPath: room.lastReceiptPath,
      source: "lastReceiptPath",
    } : null,
    ...(Array.isArray(room.recentRuns) ? room.recentRuns.map((run) => ({
      runId: run.runId || "",
      receiptPath: run.receiptPath || "",
      source: "recentRuns",
    })) : []),
  ].filter((entry) => entry?.receiptPath);

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.receiptPath)) continue;
    seen.add(entry.receiptPath);
    const callCandidate = looksLikeCallRun(entry);
    if (!exists(entry.receiptPath)) {
      if (callCandidate) {
        throw anchorError(
          "response.user_anchor_receipt_unavailable",
          "Latest ChatGPT call receipt is unavailable; refusing to fall back to an older call.",
          entry,
        );
      }
      continue;
    }

    let receipt = null;
    try {
      receipt = readJson(entry.receiptPath);
    } catch (error) {
      if (callCandidate) {
        throw anchorError(
          "response.user_anchor_receipt_unreadable",
          "Latest ChatGPT call receipt is unreadable; refusing to fall back to an older call.",
          { ...entry, error: String(error?.message || error) },
        );
      }
      continue;
    }

    if (receipt?.loop !== "chatgpt-call") continue;
    const sentUserMessage = receipt?.messageAnchor?.sentUserMessage;
    if (!sentUserMessage) {
      throw anchorError(
        "response.user_anchor_missing",
        "Latest ChatGPT call receipt has no sent user message anchor.",
        entry,
      );
    }
    return {
      receiptPath: entry.receiptPath,
      runId: receipt.operation?.runId || receipt.runId || entry.runId || null,
      sentUserMessage,
    };
  }
  return null;
}
