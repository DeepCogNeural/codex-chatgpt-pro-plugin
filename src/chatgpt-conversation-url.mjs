import { evaluate, now, sleep } from "./cdp-client.mjs";
import { DEFAULT_RESPONSE_TIMEOUT_MS } from "./runtime-config.mjs";

function parsedConversation(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.hostname !== "chatgpt.com" && !parsed.hostname.endsWith(".chatgpt.com")) return null;
    const match = parsed.pathname.match(/^\/(?:g\/[^/?#]+\/)?c\/([^/?#]+)/i);
    const conversationId = match?.[1] || "";
    if (!conversationId || /^WEB:/i.test(conversationId)) return null;
    return {
      conversationId,
      url: `${parsed.origin}${match[0]}`,
    };
  } catch {
    return null;
  }
}

export function conversationIdFromUrl(url) {
  return parsedConversation(url)?.conversationId || "";
}

export function committedConversationUrl(url) {
  return parsedConversation(url)?.url || "";
}

export async function waitForCommittedConversationUrl(cdp, {
  timeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS,
  pollMs = 250,
  readUrl = () => evaluate(cdp, "location.href"),
} = {}) {
  const startedAt = now();
  let lastObservedUrl = "";
  while (now() - startedAt < timeoutMs) {
    lastObservedUrl = String(await readUrl() || "");
    const committedUrl = committedConversationUrl(lastObservedUrl);
    if (committedUrl) {
      return {
        conversationId: conversationIdFromUrl(committedUrl),
        conversationUrl: committedUrl,
        waitedMs: Math.round(now() - startedAt),
      };
    }
    await sleep(pollMs);
  }

  const error = new Error("Timed out waiting for ChatGPT to commit the new conversation URL.");
  error.errorCode = "room.conversation_url_commit_timeout";
  error.details = {
    timeoutMs,
    lastObservedUrl: lastObservedUrl || null,
    provisionalWebUrlObserved: /\/c\/WEB:/i.test(lastObservedUrl),
    rule: "Do not write a provisional WEB: URL to the room registry and do not resend the prompt.",
  };
  throw error;
}
