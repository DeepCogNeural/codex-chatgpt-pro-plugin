import assert from "node:assert/strict";
import {
  compactTaskTitle,
  resolveAgentIdentity,
  resolveAgentRoom,
  resolveTaskIdentity,
  slugifyRoomPart,
} from "../src/agent-room-policy.mjs";

assert.equal(slugifyRoomPart("Codex Worker #1"), "codex-worker-1");
assert.equal(slugifyRoomPart("019ed607-b441-7593-8c89-3428f74cfcc1").length <= 24, true);

assert.deepEqual(
  resolveAgentIdentity({
    explicitAgentId: "Review Agent",
    env: { CODEX_THREAD_ID: "ignored" },
  }),
  {
    id: "Review Agent",
    slug: "review-agent",
    source: "explicit",
  },
);

assert.match(
  resolveAgentIdentity({ env: { CODEX_THREAD_ID: "019ed607-b441-7593-8c89-3428f74cfcc1" } }).slug,
  /^local-[a-f0-9]{12}$/,
);

const agentA = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  taskTitle: "Review LP release plan and risks",
  env: {},
});
const agentA2 = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  taskTitle: "Review LP release plan and risks",
  env: {},
});
const agentB = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-b",
  taskTitle: "Review LP release plan and risks",
  env: {},
});
const agentANextTask = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  taskTitle: "Audit resume wording",
  env: {},
});
assert.equal(agentA.effectiveAlias, agentA2.effectiveAlias);
assert.notEqual(agentA.effectiveAlias, agentB.effectiveAlias);
assert.notEqual(agentA.effectiveAlias, agentANextTask.effectiveAlias);
assert.equal(agentA.requestedAlias, "critic");
assert.equal(agentA.scoped, true);
assert.equal(agentA.taskScoped, true);
assert.match(agentA.effectiveAlias, /^critic--task-review-lp-release-plan-[a-f0-9]{8}--agent-agent-a$/);
assert.equal(agentA.roomLabel, "critic / Review LP release plan and risks / agent-a");

const explicitTaskA = resolveAgentRoom({
  requestedAlias: "main",
  explicitAgentId: "agent-a",
  explicitTaskId: "polymarket-lp-release-plan",
  taskTitle: "first prompt",
  env: {},
});
const explicitTaskA2 = resolveAgentRoom({
  requestedAlias: "main",
  explicitAgentId: "agent-a",
  explicitTaskId: "polymarket-lp-release-plan",
  taskTitle: "follow-up prompt",
  env: {},
});
assert.equal(explicitTaskA.effectiveAlias, explicitTaskA2.effectiveAlias);
assert.equal(explicitTaskA.task.source, "explicit");

assert.equal(
  resolveTaskIdentity({
    env: { CODEX_THREAD_ID: "019ed607-b441-7593-8c89-3428f74cfcc1" },
    taskTitle: "ignored when Codex task env exists",
  }).slug,
  "019ed607-b441-7593-8c89",
);

const shared = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  explicitTaskId: "task-a",
  sharedRoom: true,
  env: {},
});
assert.equal(shared.effectiveAlias, "critic");
assert.equal(shared.scoped, false);
assert.equal(shared.taskScoped, false);

assert.equal(
  compactTaskTitle("# Fix ChatGPT room reuse\n\nDetails here", { fallback: "fallback" }),
  "Fix ChatGPT room reuse",
);
assert.equal(compactTaskTitle("", { fallback: "fallback" }), "fallback");

console.log(JSON.stringify({ ok: true, tested: "agent-room-policy" }, null, 2));
