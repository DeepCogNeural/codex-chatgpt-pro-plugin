import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanupModeForGenerationState,
  isDuplicateUploadModalText,
} from "../src/chatgpt-cleanup.mjs";

assert.equal(isDuplicateUploadModalText("You've already uploaded this file.\nTry uploading something new."), true);
assert.equal(isDuplicateUploadModalText("Upload complete."), false);

assert.deepEqual(cleanupModeForGenerationState({ active: false }), {
  dismissDuplicateModal: true,
  removeStaleAttachments: true,
});
assert.deepEqual(cleanupModeForGenerationState({ active: true }), {
  dismissDuplicateModal: true,
  removeStaleAttachments: false,
});
assert.deepEqual(cleanupModeForGenerationState({ active: null }), {
  dismissDuplicateModal: true,
  removeStaleAttachments: false,
});

const help = spawnSync(process.execPath, [resolve("bin/chatgpt-pro"), "help"], {
  cwd: resolve("."),
  encoding: "utf8",
});
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /cleanup duplicate-upload\s+Dismiss duplicate-upload modals/);

const script = readFileSync(resolve("scripts/chatgpt-cleanup.mjs"), "utf8");
assert.match(script, /acquireChatGptOperation/);
assert.match(script, /cleanup\.duplicate-upload/);

console.log(JSON.stringify({ ok: true, tested: "cleanup-duplicate-upload" }, null, 2));
