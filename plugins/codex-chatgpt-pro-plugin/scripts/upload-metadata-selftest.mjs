import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chatGptConversationScopeUrl,
  classifyUploadEvidence,
  describeUploadFiles,
  messageUploadScopeKey,
  prepareUploadFiles,
  projectSourceUploadScopeKey,
  recordUploadedFiles,
  stageUploadFiles,
} from "../src/chatgpt-upload.mjs";

const dir = mkdtempSync(join(tmpdir(), "chatgpt-upload-"));

try {
  const filePath = join(dir, "upload-note.txt");
  writeFileSync(filePath, "upload metadata proof\n");

  const [record] = describeUploadFiles([filePath]);
  assert.equal(record.name, "upload-note.txt");
  assert.equal(record.bytes, 22);
  assert.equal(typeof record.sha256, "string");
  assert.equal(record.sha256.length, 64);

  const staged = stageUploadFiles([filePath], {
    stageDir: join(dir, "uploads"),
    stamp: "2026-06-17T07-41-00-000Z",
  });
  assert.equal(staged.length, 1);
  assert.match(staged[0].name, /^upload-note\.[a-f0-9]{12}\.2026-06-17T07-41-00-000Z\.txt$/);
  assert.equal(staged[0].original.name, "upload-note.txt");
  assert.equal(staged[0].original.sha256, record.sha256);
  assert.notEqual(staged[0].sha256, record.sha256);
  assert.equal(existsSync(staged[0].path), true);
  const stagedText = readFileSync(staged[0].path, "utf8");
  assert.match(stagedText, /chatgpt-pro-codex staged upload metadata/);
  assert.match(stagedText, /original-sha256:/);
  assert.match(stagedText, /content-version-sha256:/);
  assert.doesNotMatch(stagedText, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(stagedText, /original-path: \//);
  assert.match(stagedText, /upload metadata proof/);

  const ledgerPath = join(dir, "state", "chatgpt-upload-ledger.json");
  const firstPrepared = prepareUploadFiles([filePath], {
    stageDir: join(dir, "ledger-uploads-1"),
    ledgerPath,
    scopeKey: "project:https://chatgpt.com/g/polymarket-lp",
    stamp: "2026-06-17T07-42-00-000Z",
  });
  assert.equal(firstPrepared.files.length, 1);
  assert.equal(firstPrepared.skipped.length, 0);
  recordUploadedFiles(firstPrepared, { uploadedAt: "2026-06-17T07:42:10.000Z" });

  const secondPrepared = prepareUploadFiles([filePath], {
    stageDir: join(dir, "ledger-uploads-2"),
    ledgerPath,
    scopeKey: "project:https://chatgpt.com/g/polymarket-lp",
    stamp: "2026-06-17T07-43-00-000Z",
  });
  assert.equal(secondPrepared.files.length, 0);
  assert.equal(secondPrepared.skipped.length, 1);
  assert.equal(secondPrepared.skipped[0].reason, "already_uploaded_same_content");
  assert.equal(secondPrepared.skipped[0].original.sha256, record.sha256);
  assert.equal(existsSync(join(dir, "state", "unused-ledger.json")), false);

  const firstConversationScope = messageUploadScopeKey({
    projectId: "cgpt_repo",
    chatGptProjectUrl: "https://chatgpt.com/g/polymarket-lp",
    session: "polymarket-lp",
    conversationUrl: "https://chatgpt.com/c/one",
  });
  const secondConversationScope = messageUploadScopeKey({
    projectId: "cgpt_repo",
    chatGptProjectUrl: "https://chatgpt.com/g/polymarket-lp",
    session: "polymarket-lp",
    conversationUrl: "https://chatgpt.com/c/two",
  });
  assert.notEqual(firstConversationScope, secondConversationScope);
  recordUploadedFiles({
    files: firstPrepared.files,
    ledgerPath,
    scopeKey: firstConversationScope,
  }, { uploadedAt: "2026-06-17T07:42:20.000Z" });
  const sameProjectDifferentConversation = prepareUploadFiles([filePath], {
    stageDir: join(dir, "ledger-uploads-different-conversation"),
    ledgerPath,
    scopeKey: secondConversationScope,
    stamp: "2026-06-17T07-43-30-000Z",
  });
  assert.equal(sameProjectDifferentConversation.files.length, 1);
  assert.equal(sameProjectDifferentConversation.skipped.length, 0);

  writeFileSync(filePath, "upload metadata proof\nwith changed content\n");
  const changedPrepared = prepareUploadFiles([filePath], {
    stageDir: join(dir, "ledger-uploads-3"),
    ledgerPath,
    scopeKey: "project:https://chatgpt.com/g/polymarket-lp",
    stamp: "2026-06-17T07-44-00-000Z",
  });
  assert.equal(changedPrepared.files.length, 1);
  assert.equal(changedPrepared.skipped.length, 0);
  assert.notEqual(changedPrepared.files[0].original.sha256, record.sha256);
  assert.match(changedPrepared.files[0].name, /^upload-note\.[a-f0-9]{12}\.2026-06-17T07-44-00-000Z\.txt$/);
  assert.equal(
    chatGptConversationScopeUrl("https://chatgpt.com/c/one?model=gpt-5"),
    "https://chatgpt.com/c/one",
  );
  assert.equal(
    chatGptConversationScopeUrl("https://chatgpt.com/g/polymarket-lp/c/one?model=gpt-5"),
    "https://chatgpt.com/g/polymarket-lp/c/one",
  );
  assert.equal(chatGptConversationScopeUrl("https://chatgpt.com/g/polymarket-lp"), "");
  assert.equal(
    messageUploadScopeKey({
      projectId: "cgpt_repo",
      chatGptProjectUrl: "https://chatgpt.com/g/polymarket-lp",
      session: "polymarket-lp",
      conversationUrl: "https://chatgpt.com/c/one",
    }),
    "message|cgpt_repo|conversation:https://chatgpt.com/c/one",
  );
  assert.equal(
    messageUploadScopeKey({
      projectId: "cgpt_repo",
      chatGptProjectUrl: "https://chatgpt.com/g/polymarket-lp",
      session: "polymarket-lp",
      conversationUrl: "https://chatgpt.com/g/polymarket-lp/c/one",
    }),
    "message|cgpt_repo|conversation:https://chatgpt.com/g/polymarket-lp/c/one",
  );
  assert.equal(
    messageUploadScopeKey({
      projectId: "cgpt_repo",
      chatGptProjectUrl: "https://chatgpt.com/g/polymarket-lp",
      session: "polymarket-lp",
      conversationUrl: "https://chatgpt.com/g/polymarket-lp",
    }),
    "",
  );
  assert.equal(
    projectSourceUploadScopeKey({
      projectId: "cgpt_repo",
      projectUrl: "https://chatgpt.com/g/polymarket-lp",
    }),
    "project-source|cgpt_repo|https://chatgpt.com/g/polymarket-lp",
  );
  assert.deepEqual(
    classifyUploadEvidence({
      duplicateUploadModal: true,
      formText: "You've already uploaded this file. Try uploading something new.",
      chips: [],
      inputFiles: [],
    }, ["upload-note.txt"]),
    {
      allVisible: false,
      duplicateUploadModal: true,
      uploading: false,
      visibleFileNames: [],
    },
  );
  assert.deepEqual(
    classifyUploadEvidence({
      duplicateUploadModal: false,
      formText: "Uploading...",
      chips: [{ text: "upload-note.txt", aria: "", testid: "" }],
      inputFiles: [],
    }, ["upload-note.txt"]),
    {
      allVisible: true,
      duplicateUploadModal: false,
      uploading: true,
      visibleFileNames: ["upload-note.txt"],
    },
  );

  assert.throws(
    () => describeUploadFiles([join(dir, "missing.txt")]),
    /Upload file does not exist/,
  );

  const subdir = join(dir, "folder");
  mkdirSync(subdir);
  assert.throws(
    () => describeUploadFiles([subdir]),
    /Upload path is not a file/,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "upload-metadata" }, null, 2));
