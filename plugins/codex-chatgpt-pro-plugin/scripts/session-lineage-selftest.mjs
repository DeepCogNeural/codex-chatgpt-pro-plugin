import assert from "node:assert/strict";
import { dirname } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lineage-test-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lineage-home-"));
process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const {
  normalizeSessionRegistry,
  recordChatGptAliasUse,
  recordFreshThread,
  sessionRegistryPath,
} = await import(`../src/chatgpt-sessions.mjs?test=${Date.now()}`);
const { ensureProjectState } = await import(`../src/project-state.mjs?test=${Date.now()}`);

try {
  const project = ensureProjectState();
  const legacy = normalizeSessionRegistry({
    aliases: {
      main: {
        targetId: "target-1",
        url: "https://chatgpt.com/c/legacy-room",
        title: "Legacy Room",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  }, project);

  assert.equal(legacy.schemaVersion, 2);
  assert.equal(legacy.rooms.main.activeThreadId, "chatgpt:legacy-room");
  assert.equal(legacy.rooms.main.lineage.length, 1);
  assert.equal(legacy.rooms.main.lineage[0].status, "active");

  mkdirSync(dirname(sessionRegistryPath), { recursive: true });
  writeFileSync(sessionRegistryPath, `${JSON.stringify(legacy, null, 2)}\n`);
  const aliasUse = recordChatGptAliasUse({
    name: "main",
    target: {
      id: "target-1",
      title: "Legacy Room",
      url: "https://chatgpt.com/c/legacy-room",
    },
    runId: "run-1",
    receiptPath: "/tmp/run-1/receipt.json",
    transcriptPath: "/tmp/run-1/transcript.md",
    agentRoom: {
      requestedAlias: "main",
      scoped: true,
      scope: "task",
      taskScoped: true,
      agentScoped: false,
      agent: { id: "agent-a", slug: "agent-a", source: "explicit" },
      task: { id: "task-a", slug: "task-a", source: "explicit" },
      taskTitle: "Review task",
      roomLabel: "main / Review task / agent-a",
    },
  });
  assert.equal(aliasUse.callCount, 1);
  assert.equal(aliasUse.recentRuns[0].runId, "run-1");
  assert.equal(aliasUse.lineage[0].lastRunId, "run-1");
  assert.equal(aliasUse.requestedAlias, "main");
  assert.equal(aliasUse.scope, "task");
  assert.equal(aliasUse.agentScoped, false);
  assert.equal(aliasUse.taskScoped, true);
  assert.equal(aliasUse.agent.slug, "agent-a");
  assert.equal(aliasUse.task.slug, "task-a");
  assert.equal(aliasUse.taskTitle, "Review task");
  assert.equal(aliasUse.roomLabel, "main / Review task / agent-a");

  const fresh = recordFreshThread({
    aliasHint: "critic",
    target: {
      id: "target-fresh",
      title: "Fresh Review",
      url: "https://chatgpt.com/c/fresh-review",
    },
    runId: "fresh-1",
    receiptPath: "/tmp/fresh-1/receipt.json",
    transcriptPath: "/tmp/fresh-1/transcript.md",
  });
  assert.equal(fresh.threadId, "chatgpt:fresh-review");

  const legacyAlias = "main--task-task-a--agent-agent-a";
  const newHashAlias = "main-0d6e4079f3--task-task-a-0d5c11d4a7--agent-agent-a-1f7fb33a25";
  const legacyRegistry = JSON.parse(readFileSync(sessionRegistryPath, "utf8"));
  legacyRegistry.rooms[legacyAlias] = {
    ...legacyRegistry.rooms.main,
    alias: legacyAlias,
    requestedAlias: "main",
    agent: { id: "agent-a", slug: "agent-a", source: "explicit" },
    task: { id: "task-a", slug: "task-a", source: "explicit" },
  };
  delete legacyRegistry.rooms.main;
  writeFileSync(sessionRegistryPath, `${JSON.stringify(legacyRegistry, null, 2)}\n`);
  const migrated = recordChatGptAliasUse({
    name: newHashAlias,
    target: {
      id: "target-1",
      title: "Legacy Room",
      url: "https://chatgpt.com/c/legacy-room",
    },
    runId: "run-migrated",
    receiptPath: "/tmp/run-migrated/receipt.json",
    transcriptPath: "/tmp/run-migrated/transcript.md",
    agentRoom: {
      requestedAlias: "main",
      scoped: true,
      scope: "task",
      taskScoped: true,
      agentScoped: false,
      agent: { id: "agent-a", slug: "agent-a", source: "explicit" },
      task: { id: "task-a", slug: "task-a", source: "explicit" },
      taskTitle: "Review task",
      roomLabel: "main / Review task / agent-a",
    },
  });
  assert.equal(migrated.alias, newHashAlias);
  const savedAfterMigration = JSON.parse(readFileSync(sessionRegistryPath, "utf8"));
  assert.equal(savedAfterMigration.rooms[legacyAlias], undefined);
  assert.equal(savedAfterMigration.rooms[newHashAlias].requestedAlias, "main");
  assert.equal(savedAfterMigration.rooms[newHashAlias].lastRunId, "run-migrated");

  const saved = JSON.parse(readFileSync(sessionRegistryPath, "utf8"));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.rooms[newHashAlias].recentRuns[0].runId, "run-migrated");
  assert.equal(saved.freshThreads[0].aliasHint, "critic");
  assert.equal(existsSync(sessionRegistryPath), true);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "session-lineage" }, null, 2));
