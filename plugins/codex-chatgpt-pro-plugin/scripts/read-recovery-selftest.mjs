import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { latestCallAnchorFromRoom } from "../src/chatgpt-read-recovery.mjs";

const root = mkdtempSync(resolve(tmpdir(), "chatgpt-read-recovery-"));

try {
  const oldReceiptPath = resolve(root, "old-chatgpt-call", "receipt.json");
  mkdirSync(resolve(root, "old-chatgpt-call"), { recursive: true });
  writeFileSync(oldReceiptPath, `${JSON.stringify({
    loop: "chatgpt-call",
    operation: { runId: "old-chatgpt-call" },
    messageAnchor: {
      sentUserMessage: {
        ordinal: 2,
        textSha256: "old-text",
        normalizedTextSha256: "old-normalized",
      },
    },
  }, null, 2)}\n`);

  const roomWithMissingLatest = {
    lastReceiptPath: resolve(root, "new-chatgpt-call", "receipt.json"),
    recentRuns: [
      {
        runId: "new-chatgpt-call",
        receiptPath: resolve(root, "new-chatgpt-call", "receipt.json"),
      },
      {
        runId: "old-chatgpt-call",
        receiptPath: oldReceiptPath,
      },
    ],
  };
  assert.throws(
    () => latestCallAnchorFromRoom(roomWithMissingLatest),
    /Latest ChatGPT call receipt is unavailable/,
  );

  const roomWithReadThenCall = {
    lastReceiptPath: resolve(root, "latest-read", "receipt.json"),
    recentRuns: [
      {
        runId: "latest-read",
        receiptPath: resolve(root, "latest-read", "receipt.json"),
      },
      {
        runId: "old-chatgpt-call",
        receiptPath: oldReceiptPath,
      },
    ],
  };
  mkdirSync(resolve(root, "latest-read"), { recursive: true });
  writeFileSync(resolve(root, "latest-read", "receipt.json"), `${JSON.stringify({
    loop: "chatgpt-read-current",
  }, null, 2)}\n`);
  const anchor = latestCallAnchorFromRoom(roomWithReadThenCall);
  assert.equal(anchor.sentUserMessage.textSha256, "old-text");
  assert.equal(anchor.runId, "old-chatgpt-call");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "read-recovery" }, null, 2));
