import assert from "node:assert/strict";
import {
  committedConversationUrl,
  conversationIdFromUrl,
  waitForCommittedConversationUrl,
} from "../src/chatgpt-conversation-url.mjs";

assert.equal(conversationIdFromUrl("https://chatgpt.com/c/WEB:temporary"), "");
assert.equal(committedConversationUrl("https://chatgpt.com/c/WEB:temporary"), "");
assert.equal(
  committedConversationUrl("https://chatgpt.com/g/project-name/c/committed-id?model=gpt-5"),
  "https://chatgpt.com/g/project-name/c/committed-id",
);

const observedUrls = [
  "https://chatgpt.com/c/WEB:temporary",
  "https://chatgpt.com/c/committed-id?model=gpt-5",
];
const committed = await waitForCommittedConversationUrl(null, {
  timeoutMs: 1_000,
  pollMs: 1,
  readUrl: async () => observedUrls.shift() || "https://chatgpt.com/c/committed-id",
});
assert.equal(committed.conversationId, "committed-id");
assert.equal(committed.conversationUrl, "https://chatgpt.com/c/committed-id");

await assert.rejects(
  () => waitForCommittedConversationUrl(null, {
    timeoutMs: 5,
    pollMs: 1,
    readUrl: async () => "https://chatgpt.com/c/WEB:never-committed",
  }),
  (error) => {
    assert.equal(error.errorCode, "room.conversation_url_commit_timeout");
    assert.equal(error.details.provisionalWebUrlObserved, true);
    return true;
  },
);

console.log(JSON.stringify({ ok: true, tested: "conversation-url" }, null, 2));
