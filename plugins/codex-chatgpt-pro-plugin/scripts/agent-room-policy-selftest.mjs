import assert from "node:assert/strict";
import {
  compactTaskTitle,
  resolveAgentIdentity,
  resolveAgentRoom,
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

assert.equal(
  resolveAgentIdentity({ env: { CODEX_THREAD_ID: "019ed607-b441-7593-8c89-3428f74cfcc1" } }).slug,
  "019ed607-b441-7593-8c89",
);

const agentA = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  taskTitle: "Review LP release plan and risks",
});
const agentA2 = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  taskTitle: "Review LP release plan and risks",
});
const agentB = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-b",
  taskTitle: "Review LP release plan and risks",
});
assert.equal(agentA.effectiveAlias, agentA2.effectiveAlias);
assert.notEqual(agentA.effectiveAlias, agentB.effectiveAlias);
assert.equal(agentA.requestedAlias, "critic");
assert.equal(agentA.scoped, true);
assert.match(agentA.effectiveAlias, /^critic--agent-agent-a$/);
assert.equal(agentA.roomLabel, "critic / agent-a / Review LP release plan and risks");

const shared = resolveAgentRoom({
  requestedAlias: "critic",
  explicitAgentId: "agent-a",
  sharedRoom: true,
});
assert.equal(shared.effectiveAlias, "critic");
assert.equal(shared.scoped, false);

assert.equal(
  compactTaskTitle("# Fix ChatGPT room reuse\n\nDetails here", { fallback: "fallback" }),
  "Fix ChatGPT room reuse",
);
assert.equal(compactTaskTitle("", { fallback: "fallback" }), "fallback");

console.log(JSON.stringify({ ok: true, tested: "agent-room-policy" }, null, 2));
