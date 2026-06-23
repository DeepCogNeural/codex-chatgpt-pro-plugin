import { createHash } from "node:crypto";
import { hostname, userInfo } from "node:os";

const AGENT_ENV_KEYS = [
  "CHATGPT_AGENT_ID",
  "CODEX_AGENT_ID",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "AGENT_ID",
];

function sha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

export function slugifyRoomPart(value, { maxLength = 24, fallback = "agent" } = {}) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function compactTaskTitle(text = "", { maxLength = 56, fallback = "untitled task" } = {}) {
  const firstLine = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
  const cleaned = firstLine
    .replace(/^#+\s*/, "")
    .replace(/[`*_~[\]()#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

export function resolveAgentIdentity({
  explicitAgentId = "",
  env = process.env,
} = {}) {
  if (explicitAgentId) {
    return {
      id: explicitAgentId,
      slug: slugifyRoomPart(explicitAgentId),
      source: "explicit",
    };
  }
  for (const key of AGENT_ENV_KEYS) {
    if (env[key]) {
      return {
        id: env[key],
        slug: slugifyRoomPart(env[key]),
        source: key,
      };
    }
  }
  const fallback = `${userInfo().username}@${hostname()}`;
  return {
    id: fallback,
    slug: `local-${sha256(fallback).slice(0, 12)}`,
    source: "local_user_host",
  };
}

export function resolveAgentRoom({
  requestedAlias = "",
  explicitAgentId = "",
  sharedRoom = false,
  taskTitle = "",
  env = process.env,
} = {}) {
  const baseAlias = String(requestedAlias || "").trim();
  if (!baseAlias) {
    return {
      requestedAlias: "",
      effectiveAlias: "",
      scoped: false,
      agent: null,
      taskTitle: compactTaskTitle(taskTitle),
      roomLabel: "",
    };
  }
  const agent = resolveAgentIdentity({ explicitAgentId, env });
  const title = compactTaskTitle(taskTitle);
  if (sharedRoom) {
    return {
      requestedAlias: baseAlias,
      effectiveAlias: baseAlias,
      scoped: false,
      agent,
      taskTitle: title,
      roomLabel: `${baseAlias} / shared / ${title}`,
    };
  }
  const aliasSlug = slugifyRoomPart(baseAlias, { maxLength: 36, fallback: "room" });
  const effectiveAlias = `${aliasSlug}--agent-${agent.slug}`;
  return {
    requestedAlias: baseAlias,
    effectiveAlias,
    scoped: true,
    agent,
    taskTitle: title,
    roomLabel: `${baseAlias} / ${agent.slug} / ${title}`,
  };
}
