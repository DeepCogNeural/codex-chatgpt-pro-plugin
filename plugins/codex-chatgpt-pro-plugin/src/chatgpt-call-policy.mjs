import { DEFAULT_TARGET_URL } from "./runtime-config.mjs";

export const DEFAULT_COMPLETION_MARKER = "输出完毕";
export const DEFAULT_LEVEL_PREFERENCES = ["Pro Extended", "Pro"];

export function splitPreferenceList(value) {
  return String(value || "")
    .split(/[,\|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function completionMarkerRequired({ disabled = false, env = process.env } = {}) {
  if (disabled) return false;
  const raw = env.CHATGPT_REQUIRE_COMPLETION_MARKER;
  if (raw == null || raw === "") return true;
  return !/^(0|false|no)$/i.test(String(raw).trim());
}

export function completionMarkerFromEnv({ explicitMarker = "", env = process.env } = {}) {
  return explicitMarker || env.CHATGPT_COMPLETION_MARKER || DEFAULT_COMPLETION_MARKER;
}

export function hasCompletionMarker(text, marker = DEFAULT_COMPLETION_MARKER) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) === marker;
}

export function appendCompletionMarkerInstruction(prompt, {
  marker = DEFAULT_COMPLETION_MARKER,
  required = true,
} = {}) {
  const text = String(prompt || "").trimEnd();
  if (!required || !marker) return text;
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerInstruction = new RegExp(
    `(最后一行必须只输出[^\\n]*${escapedMarker}|final (?:non-empty )?line[^\\n]*${escapedMarker})`,
    "i",
  );
  if (hasCompletionMarker(text, marker) || markerInstruction.test(text)) return text;
  return [
    text,
    "",
    "---",
    "",
    "重要：不要在还没完整思考完时提前收尾。最终答案最后一行必须只输出：",
    marker,
  ].join("\n");
}

export function completionMarkerError(text, marker, details = {}) {
  const error = new Error(`ChatGPT response did not end with required completion marker: ${marker}`);
  error.errorCode = "chatgpt.completion_marker_missing";
  error.details = {
    marker,
    assistantTextLength: String(text || "").length,
    assistantTextPreview: String(text || "").slice(-500),
    ...details,
  };
  return error;
}

export function resolveLevelRequest({
  explicitLevel = "",
  noDefaultPro = false,
  env = process.env,
} = {}) {
  if (explicitLevel) {
    return {
      explicit: true,
      requestedLevel: explicitLevel,
      levelPreferences: [explicitLevel],
      defaultedToProExtended: false,
    };
  }
  if (noDefaultPro) {
    return {
      explicit: false,
      requestedLevel: "",
      levelPreferences: [],
      defaultedToProExtended: false,
    };
  }
  const source = env.CHATGPT_DEFAULT_LEVEL || DEFAULT_LEVEL_PREFERENCES.join(",");
  const preferences = splitPreferenceList(source);
  return {
    explicit: false,
    requestedLevel: preferences.join(","),
    levelPreferences: preferences,
    defaultedToProExtended: preferences[0] === DEFAULT_LEVEL_PREFERENCES[0],
  };
}

export function resolveChatGptProjectTarget({
  explicitProjectUrl = "",
  configuredProjectUrl = "",
  env = process.env,
} = {}) {
  return explicitProjectUrl || env.CHATGPT_PROJECT_URL || configuredProjectUrl || "";
}

export function shouldRecordAliasUseAfterCall(receipt = {}, { freshThread = false } = {}) {
  if (freshThread) return false;
  return Boolean(
    receipt?.ok
    || receipt?.messageAnchor?.sentUserMessage
    || receipt?.messageAnchor?.assistantStarted
  );
}

export function shouldRecordFreshThreadAfterCall(receipt = {}, { freshThread = false } = {}) {
  if (!freshThread) return false;
  return Boolean(
    receipt?.ok
    || receipt?.messageAnchor?.sentUserMessage
    || receipt?.messageAnchor?.assistantStarted
  );
}

export function markAliasRecordFailure(receipt = {}, error = null, {
  errorCode = "session.alias_update_failed_after_send",
} = {}) {
  const conversationUrl = receipt.conversationUrl
    || receipt.response?.conversationUrl
    || receipt.room?.conversationUrl
    || receipt.messageAnchor?.sentUserMessage?.conversationUrl
    || "";
  const previousErrorCode = receipt.errorCode || null;
  const previousError = receipt.error || null;
  receipt.aliasRecordError = {
    errorCode: error?.errorCode || "session.alias_update_empty",
    error: error ? String(error?.message || error) : "Room registry write returned no alias record.",
    ...(error?.details ? { details: error.details } : {}),
  };
  Object.assign(receipt, {
    ok: false,
    errorCode,
    error: "ChatGPT prompt was sent, but the room registry could not be updated. Do not resend; use the receipt conversationUrl for recovery.",
    doNotResend: true,
    conversationUrl: conversationUrl || null,
    ...(previousErrorCode ? { previousErrorCode } : {}),
    ...(previousError ? { previousError } : {}),
  });
  return receipt;
}

export function applySendStatusFromError(receipt = {}, error = null) {
  const details = error?.details || {};
  const sendAttempted = details.sendAttempted === true
    || (Array.isArray(details.attempts) && details.attempts.some((attempt) => attempt?.clicked));
  if (!sendAttempted || receipt.messageAnchor?.sentUserMessage) return false;
  receipt.messageSendState = {
    status: "send_status_unknown",
    automaticResendAllowed: false,
    reason: error?.errorCode || "send_attempt_unverified",
  };
  receipt.doNotResend = true;
  return true;
}

export function resolveThreadPolicy({
  session = "",
  freshThread = false,
  requestedNewBoundThread = false,
  reuseRoom = false,
  rebindAlias = false,
  targetUrl = DEFAULT_TARGET_URL,
  chatGptProjectUrl = "",
  envNewChat = null,
} = {}) {
  if (freshThread && requestedNewBoundThread) {
    const error = new Error("Use only one of --fresh or --new.");
    error.errorCode = "session.thread_mode_conflict";
    throw error;
  }
  if (freshThread && reuseRoom) {
    const error = new Error("Use only one of --fresh or --reuse-room.");
    error.errorCode = "session.thread_mode_conflict";
    throw error;
  }
  if (requestedNewBoundThread && reuseRoom) {
    const error = new Error("Use only one of --new or --reuse-room.");
    error.errorCode = "session.thread_mode_conflict";
    throw error;
  }

  const projectScoped = Boolean(chatGptProjectUrl);
  const defaultNewBoundThread = Boolean(projectScoped && session && !reuseRoom && !rebindAlias);
  const newBoundThread = requestedNewBoundThread || defaultNewBoundThread;
  const newChat = freshThread
    || newBoundThread
    || ((!reuseRoom && !rebindAlias) && (envNewChat == null
      ? (!session && (targetUrl === DEFAULT_TARGET_URL || projectScoped))
      : Boolean(envNewChat)));
  const threadMode = freshThread
    ? "fresh"
    : newBoundThread
      ? (projectScoped && !requestedNewBoundThread ? "project_new_bound" : "new_bound")
      : rebindAlias
        ? "rebind"
        : reuseRoom
          ? "reuse"
          : "continue";

  return {
    projectScoped,
    newBoundThread,
    newChat,
    threadMode,
    aliasBound: Boolean(session && !freshThread),
  };
}
