import assert from "node:assert/strict";
import { submitPrompt } from "../src/chatgpt-composer.mjs";

let clickCount = 0;
await assert.rejects(
  () => submitPrompt(null, {
    composer: {},
    initialUserCount: 0,
    clickSendButton: async () => {
      clickCount += 1;
      return { clicked: true, label: "Send", method: "dom-button" };
    },
    waitForSubmissionFn: async () => {
      throw new Error("probe failed after click");
    },
    composerTextFn: async () => "prompt still visible",
  }),
  (error) => {
    assert.equal(error.errorCode, "chatgpt.prompt_not_submitted");
    assert.equal(error.details.sendAttempted, true);
    assert.equal(error.details.attempts.length, 1);
    assert.equal(error.details.confirmationError, "probe failed after click");
    return true;
  },
);
assert.equal(clickCount, 1);

let timeoutClickCount = 0;
await assert.rejects(
  () => submitPrompt(null, {
    composer: {},
    initialUserCount: 0,
    clickSendButton: async () => {
      timeoutClickCount += 1;
      return { clicked: true, label: "Send", method: "dom-button" };
    },
    waitForSubmissionFn: async () => ({ submitted: false, probe: { userTurns: [], assistantTurns: [] } }),
    composerTextFn: async () => "prompt still visible",
  }),
  (error) => {
    assert.equal(error.errorCode, "chatgpt.prompt_not_submitted");
    assert.equal(error.details.sendAttempted, true);
    assert.equal(error.details.attempts.length, 1);
    return true;
  },
);
assert.equal(timeoutClickCount, 1);

console.log(JSON.stringify({ ok: true, tested: "submit-prompt" }, null, 2));
