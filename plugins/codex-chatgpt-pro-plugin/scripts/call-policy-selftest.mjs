import assert from "node:assert/strict";
import {
  DEFAULT_COMPLETION_MARKER,
  appendCompletionMarkerInstruction,
  completionMarkerRequired,
  hasCompletionMarker,
  resolveChatGptProjectTarget,
  resolveLevelRequest,
  resolveThreadPolicy,
} from "../src/chatgpt-call-policy.mjs";

assert.equal(DEFAULT_COMPLETION_MARKER, "输出完毕");
assert.equal(completionMarkerRequired({ env: {} }), true);
assert.equal(completionMarkerRequired({ env: { CHATGPT_REQUIRE_COMPLETION_MARKER: "0" } }), false);

const prompt = appendCompletionMarkerInstruction("Review this repo.", { marker: "输出完毕", required: true });
assert.match(prompt, /最后一行必须只输出/);
assert.match(prompt, /输出完毕$/);
assert.equal(appendCompletionMarkerInstruction(prompt, { marker: "输出完毕", required: true }), prompt);
assert.match(
  appendCompletionMarkerInstruction("Discuss why 输出完毕 is the marker.", { marker: "输出完毕", required: true }),
  /最后一行必须只输出/,
);
assert.match(
  appendCompletionMarkerInstruction("Review this. The final line must be PASS or NEEDS_CHANGES.", { marker: "输出完毕", required: true }),
  /输出完毕$/,
);

assert.equal(hasCompletionMarker("analysis\n\n输出完毕", "输出完毕"), true);
assert.equal(hasCompletionMarker("输出完毕\nextra", "输出完毕"), false);
assert.equal(hasCompletionMarker("analysis only", "输出完毕"), false);

assert.deepEqual(
  resolveLevelRequest({ env: {} }),
  {
    explicit: false,
    requestedLevel: "Pro Extended,Pro",
    levelPreferences: ["Pro Extended", "Pro"],
    defaultedToProExtended: true,
  },
);
assert.deepEqual(
  resolveLevelRequest({ explicitLevel: "High", env: {} }),
  {
    explicit: true,
    requestedLevel: "High",
    levelPreferences: ["High"],
    defaultedToProExtended: false,
  },
);
assert.equal(resolveLevelRequest({ noDefaultPro: true, env: {} }).requestedLevel, "");

assert.equal(
  resolveChatGptProjectTarget({ env: { CHATGPT_PROJECT_URL: "https://chatgpt.com/g/project-1" } }),
  "https://chatgpt.com/g/project-1",
);

const projectDefault = resolveThreadPolicy({
  session: "polymarket-lp",
  chatGptProjectUrl: "https://chatgpt.com/g/project-1",
  targetUrl: "https://chatgpt.com/g/project-1",
});
assert.equal(projectDefault.projectScoped, true);
assert.equal(projectDefault.newBoundThread, true);
assert.equal(projectDefault.newChat, true);
assert.equal(projectDefault.threadMode, "project_new_bound");

const projectReuse = resolveThreadPolicy({
  session: "polymarket-lp",
  reuseRoom: true,
  envNewChat: true,
  chatGptProjectUrl: "https://chatgpt.com/g/project-1",
  targetUrl: "https://chatgpt.com/g/project-1",
});
assert.equal(projectReuse.newBoundThread, false);
assert.equal(projectReuse.newChat, false);
assert.equal(projectReuse.threadMode, "reuse");

assert.throws(
  () => resolveThreadPolicy({ freshThread: true, requestedNewBoundThread: true }),
  /Use only one of --fresh or --new/,
);

console.log(JSON.stringify({ ok: true, tested: "call-policy" }, null, 2));
