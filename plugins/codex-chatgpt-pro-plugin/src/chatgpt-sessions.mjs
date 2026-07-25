import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CdpSession, listTargets } from "./cdp-client.mjs";
import { DEFAULT_TARGET_URL, stateRoot } from "./runtime-config.mjs";
import { canonicalSessionRegistryPath, ensureProjectState } from "./project-state.mjs";
import { writeJsonAtomic } from "./atomic-json.mjs";
import { withProjectStateLockSync } from "./project-state-lock.mjs";
import {
  committedConversationUrl,
  conversationIdFromUrl,
} from "./chatgpt-conversation-url.mjs";

export { conversationIdFromUrl } from "./chatgpt-conversation-url.mjs";

export const legacySessionRegistryPath = resolve(stateRoot, "chatgpt-sessions.json");
export const sessionRegistryPath = canonicalSessionRegistryPath(ensureProjectState().projectId);

const RECENT_RUN_LIMIT = 10;
const DEFAULT_STALE_AFTER_DAYS = 21;

const roomDefaults = {
  main: {
    purpose: "Primary repo collaboration room",
    lifecycle: "long_lived",
  },
  debug: {
    purpose: "Focused failure/debugging room",
    lifecycle: "bug_family",
  },
  critic: {
    purpose: "Independent review room",
    lifecycle: "review",
  },
  scratch: {
    purpose: "Disposable prompt/context check room",
    lifecycle: "disposable",
  },
};

function nowIso() {
  return new Date().toISOString();
}

function sha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function mismatchError(name, saved, project) {
  const error = new Error(
    `ChatGPT session alias "${name}" belongs to a different project. Use --rebind-alias to bind it to this repo.`,
  );
  error.errorCode = "session.alias_project_mismatch";
  error.details = {
    alias: name,
    currentProjectId: project.projectId,
    currentRepoRoot: project.repoRoot,
    aliasProjectId: saved?.projectId || null,
    aliasRepoRoot: saved?.repoRoot || null,
  };
  return error;
}

function threadIdFromUrl(url, fallback = "") {
  try {
    const parsed = new URL(url || "");
    const match = parsed.pathname.match(/\/c\/([^/?#]+)/);
    if (match?.[1]) return `chatgpt:${match[1]}`;
  } catch {
    // Fall through to a stable fallback.
  }
  if (fallback) return `target:${fallback}`;
  return `unknown:${sha256(url).slice(0, 16)}`;
}

function sameConversationUrl(a, b) {
  const aId = conversationIdFromUrl(a);
  const bId = conversationIdFromUrl(b);
  return Boolean(aId && bId && aId === bId);
}

function roomError(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function roomPurpose(name, saved, project) {
  return saved?.purpose
    || roomDefaults[name]?.purpose
    || `ChatGPT ${name} room for ${project.displayName}`;
}

function roomLifecycle(name, saved) {
  return saved?.lifecycle || roomDefaults[name]?.lifecycle || "long_lived";
}

function normalizeLineage({ name, saved, activeThreadId, activeConversationUrl, createdAt }) {
  const existing = Array.isArray(saved?.lineage) ? saved.lineage : [];
  if (existing.length) return existing;
  if (!activeConversationUrl) return [];

  return [
    {
      threadId: activeThreadId,
      conversationUrl: activeConversationUrl,
      status: "active",
      openedAt: createdAt,
      openedByRunId: saved?.lastRunId || null,
      openedReason: saved?.openedReason || `migrated ${name} alias`,
      closedAt: null,
      closedByRunId: null,
      closedReason: null,
      firstRunId: saved?.lastRunId || null,
      lastRunId: saved?.lastRunId || null,
      lastReceiptPath: saved?.lastReceiptPath || null,
    },
  ];
}

function normalizeRecentRuns(saved) {
  if (Array.isArray(saved?.recentRuns)) return saved.recentRuns.slice(0, RECENT_RUN_LIMIT);
  if (!saved?.lastRunId) return [];
  return [
    {
      runId: saved.lastRunId,
      receiptPath: saved.lastReceiptPath || null,
      transcriptPath: saved.lastTranscriptPath || null,
      createdAt: saved.lastUsedAt || saved.updatedAt || saved.createdAt || nowIso(),
    },
  ];
}

function normalizeRoom(name, saved = {}, project = ensureProjectState()) {
  const activeConversationUrl = saved.activeConversationUrl || saved.conversationUrl || saved.url || "";
  const targetId = saved.targetId || null;
  const activeThreadId = saved.activeThreadId || saved.threadId || threadIdFromUrl(activeConversationUrl, targetId);
  const createdAt = saved.createdAt || saved.updatedAt || nowIso();
  const lastUsedAt = saved.lastUsedAt || saved.updatedAt || null;
  return {
    alias: name,
    projectId: saved.projectId || project.projectId,
    repoRoot: saved.repoRoot || project.repoRoot,
    projectDisplayName: saved.projectDisplayName || project.displayName,
    requestedAlias: saved.requestedAlias || name,
    scope: saved.scope || (saved.taskScoped ? "task" : saved.agentScoped ? "agent" : "legacy"),
    agentScoped: saved.agentScoped === true,
    taskScoped: saved.taskScoped === true,
    agent: saved.agent || null,
    task: saved.task || null,
    taskTitle: saved.taskTitle || "",
    roomLabel: saved.roomLabel || "",
    purpose: roomPurpose(name, saved, project),
    lifecycle: roomLifecycle(name, saved),
    activeThreadId,
    activeConversationUrl,
    conversationUrl: activeConversationUrl,
    url: activeConversationUrl,
    targetId,
    title: saved.title || "",
    responseMode: saved.responseMode || "blocking",
    createdAt,
    lastUsedAt,
    updatedAt: saved.updatedAt || nowIso(),
    lastRunId: saved.lastRunId || null,
    lastReceiptPath: saved.lastReceiptPath || null,
    lastTranscriptPath: saved.lastTranscriptPath || null,
    callCount: Number(saved.callCount || (saved.lastRunId ? 1 : 0)),
    staleAfterDays: Number(saved.staleAfterDays || DEFAULT_STALE_AFTER_DAYS),
    roomTargetVerification: saved.roomTargetVerification || null,
    lastTargetRepair: saved.lastTargetRepair || null,
    recentRuns: normalizeRecentRuns(saved),
    lineage: normalizeLineage({ name, saved, activeThreadId, activeConversationUrl, createdAt }),
  };
}

function normalizeFreshThreads(raw) {
  return Array.isArray(raw?.freshThreads) ? raw.freshThreads : [];
}

export function normalizeSessionRegistry(raw, project = ensureProjectState()) {
  const sourceRooms = raw?.rooms || raw?.aliases || raw?.sessions || {};
  const normalized = {
    schemaVersion: 2,
    projectId: project.projectId,
    ...(raw?.projectId && raw.projectId !== project.projectId ? { migratedProjectIdFrom: raw.projectId } : {}),
    rooms: {},
    freshThreads: normalizeFreshThreads(raw),
  };

  for (const [name, saved] of Object.entries(sourceRooms)) {
    normalized.rooms[name] = normalizeRoom(name, saved, project);
  }

  return normalized;
}

function registryPathForProject(project = ensureProjectState()) {
  return canonicalSessionRegistryPath(project.projectId);
}

function readRegistry() {
  const project = ensureProjectState();
  const canonicalPath = registryPathForProject(project);
  try {
    return normalizeSessionRegistry(JSON.parse(readFileSync(canonicalPath, "utf8")), project);
  } catch {
    if (existsSync(legacySessionRegistryPath)) {
      try {
        const migrated = normalizeSessionRegistry(JSON.parse(readFileSync(legacySessionRegistryPath, "utf8")), project);
        return withProjectStateLockSync({ project, reason: "migrate-legacy-session-registry" }, () => {
          writeRegistry(migrated);
          return migrated;
        });
      } catch {
        // Fall through to an empty registry.
      }
    }
    return normalizeSessionRegistry({ rooms: {} }, project);
  }
}

function writeRegistry(registry) {
  const project = ensureProjectState();
  const canonicalPath = registryPathForProject(project);
  writeJsonAtomic(canonicalPath, normalizeSessionRegistry(registry, project));
}

function sameIdentityPart(a, b) {
  return Boolean(a?.id && b?.id && a.id === b.id);
}

function roomMatchesAgentRoom(room, agentRoom, project) {
  if (!room || !agentRoom?.requestedAlias) return false;
  if (room.projectId && room.projectId !== project.projectId) return false;
  return room.requestedAlias === agentRoom.requestedAlias
    && room.scope === agentRoom.scope
    && room.taskScoped === agentRoom.taskScoped
    && sameIdentityPart(room.agent, agentRoom.agent)
    && sameIdentityPart(room.task, agentRoom.task);
}

function migrateLegacyRoomAliasInRegistry(registry, { name, agentRoom, project }) {
  if (!name || !agentRoom || agentRoom.scope === "shared" || registry.rooms[name]) {
    return registry.rooms[name] || null;
  }
  const matches = Object.entries(registry.rooms || {})
    .filter(([alias]) => alias !== name)
    .filter(([, room]) => roomMatchesAgentRoom(room, agentRoom, project));
  if (!matches.length) return null;
  if (matches.length > 1) {
    throw roomError(
      "session.alias_identity_ambiguous",
      `Multiple legacy ChatGPT room aliases match requested alias "${agentRoom.requestedAlias}". Refusing to guess.`,
      {
        requestedAlias: agentRoom.requestedAlias,
        effectiveAlias: name,
        matches: matches.map(([alias, room]) => ({
          alias,
          activeConversationUrl: room.activeConversationUrl || room.conversationUrl || room.url || null,
          lastUsedAt: room.lastUsedAt || null,
        })),
      },
    );
  }
  const [legacyAlias, legacyRoom] = matches[0];
  const migrated = normalizeRoom(name, {
    ...legacyRoom,
    requestedAlias: agentRoom.requestedAlias,
    scope: agentRoom.scope,
    taskScoped: agentRoom.taskScoped,
    agentScoped: agentRoom.agentScoped,
    agent: agentRoom.agent,
    task: agentRoom.task,
    taskTitle: agentRoom.taskTitle || legacyRoom.taskTitle || "",
    roomLabel: agentRoom.roomLabel || legacyRoom.roomLabel || "",
  }, project);
  migrated.migratedAliasFrom = legacyAlias;
  migrated.migratedAliasAt = nowIso();
  registry.rooms[name] = migrated;
  delete registry.rooms[legacyAlias];
  return registry.rooms[name];
}

export function migrateLegacyRoomAlias({ name, agentRoom } = {}) {
  const project = ensureProjectState();
  return withProjectStateLockSync({ project, reason: `migrate-room-alias:${name}` }, () => {
    const registry = readRegistry();
    const migrated = migrateLegacyRoomAliasInRegistry(registry, { name, agentRoom, project });
    if (migrated) writeRegistry(registry);
    return migrated;
  });
}

function isChatGptTarget(target) {
  try {
    const url = new URL(target.url || "");
    return url.hostname === "chatgpt.com" || url.hostname.endsWith(".chatgpt.com");
  } catch {
    return false;
  }
}

function targetSummary(target, aliases = []) {
  return {
    id: target.id,
    title: target.title,
    url: target.url,
    aliases,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
  };
}

function targetFromConversationUrl(url, {
  id = "",
  title = "",
  webSocketDebuggerUrl = "",
} = {}) {
  const conversationId = conversationIdFromUrl(url);
  if (!conversationId) {
    const error = new Error(`Invalid ChatGPT conversation URL: ${url}`);
    error.errorCode = "room.conversation_url_invalid";
    error.details = { conversationUrl: url || null };
    throw error;
  }
  return targetSummary({
    id: id || `registry:${conversationId}`,
    title: title || `ChatGPT conversation ${conversationId}`,
    url,
    webSocketDebuggerUrl,
  });
}

function targetThreadId(target) {
  return threadIdFromUrl(target?.url, target?.id);
}

function archiveActiveLineage(lineage, { closedAt, closedByRunId, closedReason } = {}) {
  return lineage.map((entry) => entry.status === "active"
    ? {
        ...entry,
        status: "archived",
        closedAt,
        closedByRunId: closedByRunId || null,
        closedReason: closedReason || "replaced by new active thread",
      }
    : entry);
}

function bindRoomToTarget({ room, name, target, project, openedReason, archivePrevious = true }) {
  const timestamp = nowIso();
  const activeConversationUrl = committedConversationUrl(target?.url);
  if (!activeConversationUrl) {
    throw roomError(
      "room.conversation_url_uncommitted",
      `Refusing to bind room "${name}" to an uncommitted ChatGPT conversation URL.`,
      {
        conversationUrl: target?.url || null,
        provisionalWebUrlObserved: /\/c\/WEB:/i.test(target?.url || ""),
      },
    );
  }
  const committedTarget = { ...target, url: activeConversationUrl };
  const activeThreadId = targetThreadId(committedTarget);
  let lineage = Array.isArray(room?.lineage)
    ? room.lineage.filter((entry) => conversationIdFromUrl(entry?.conversationUrl))
    : [];

  const changedThread = room?.activeThreadId && room.activeThreadId !== activeThreadId;
  if (changedThread && archivePrevious) {
    lineage = archiveActiveLineage(lineage, {
      closedAt: timestamp,
      closedByRunId: null,
      closedReason: openedReason || "new active thread",
    });
  }

  const activeIndex = lineage.findIndex((entry) =>
    entry.threadId === activeThreadId && entry.conversationUrl === activeConversationUrl,
  );
  const activeEntry = {
    threadId: activeThreadId,
    conversationUrl: activeConversationUrl,
    status: "active",
    openedAt: activeIndex >= 0 ? lineage[activeIndex].openedAt : timestamp,
    openedByRunId: activeIndex >= 0 ? lineage[activeIndex].openedByRunId : null,
    openedReason: activeIndex >= 0 ? lineage[activeIndex].openedReason : openedReason || "alias binding",
    closedAt: null,
    closedByRunId: null,
    closedReason: null,
    firstRunId: activeIndex >= 0 ? lineage[activeIndex].firstRunId : null,
    lastRunId: room?.lastRunId || null,
    lastReceiptPath: room?.lastReceiptPath || null,
  };
  if (activeIndex >= 0) lineage[activeIndex] = activeEntry;
  else lineage.push(activeEntry);

  const createdAt = room?.createdAt || timestamp;
  return {
    ...normalizeRoom(name, room || {}, project),
    projectId: project.projectId,
    repoRoot: project.repoRoot,
    projectDisplayName: project.displayName,
    activeThreadId,
    activeConversationUrl,
    conversationUrl: activeConversationUrl,
    url: activeConversationUrl,
    targetId: committedTarget.id,
    title: committedTarget.title,
    createdAt,
    lastUsedAt: timestamp,
    updatedAt: timestamp,
    lineage,
  };
}

export async function listChatGptSessions(port) {
  const registry = readRegistry();
  const project = ensureProjectState();
  const targets = (await listTargets(port))
    .filter((target) => target.type === "page" && target.webSocketDebuggerUrl && isChatGptTarget(target));

  return targets.map((target) => {
    const aliases = Object.entries(registry.rooms)
      .filter(([, saved]) => saved.projectId === project.projectId)
      .filter(([, saved]) =>
        saved.targetId === target.id
        || saved.activeConversationUrl === target.url
        || saved.conversationUrl === target.url
        || saved.url === target.url,
      )
      .map(([alias]) => alias);
    return targetSummary(target, aliases);
  });
}

async function cdpJson(port, path, { method = "GET" } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  if (!response.ok) throw new Error(`CDP ${path} -> ${response.status}`);
  return response.json();
}

async function openChatGptTarget(port, url) {
  let target;
  try {
    target = await cdpJson(port, `/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  } catch {
    target = await cdpJson(port, `/json/new?${encodeURIComponent(url)}`);
  }
  await fetch(`http://127.0.0.1:${port}/json/activate/${target.id}`);
  return target;
}

export async function newChatGptSession(port, { name, url = DEFAULT_TARGET_URL, bind = Boolean(name) } = {}) {
  const target = await openChatGptTarget(port, url);
  const canBind = Boolean(name && bind && conversationIdFromUrl(target.url));
  if (canBind) {
    await aliasChatGptSession(port, {
      name,
      targetId: target.id,
      openedReason: "new bound thread",
      roomTargetVerification: "verified_live",
    });
  }
  return targetSummary(target, canBind ? [name] : []);
}

export async function aliasChatGptSession(port, {
  name,
  targetId,
  conversationUrl,
  openedReason = "alias binding",
  archivePrevious = true,
  roomTargetVerification = "",
  lastTargetRepair = null,
} = {}) {
  const project = ensureProjectState();
  if (!name) throw new Error("Session alias name is required.");
  const sessions = await listChatGptSessions(port);
  const target = targetId
    ? sessions.find((session) => session.id === targetId)
    : conversationUrl
      ? sessions.find((session) => session.url === conversationUrl)
      : sessions[0];
  if (!target) throw new Error(`ChatGPT target not found for id/url: ${targetId || conversationUrl || "(first)"}`);

  return withProjectStateLockSync({ project, reason: `alias:${name}` }, () => {
    const registry = readRegistry();
    const existing = registry.rooms[name];
    if (existing?.projectId && existing.projectId !== project.projectId) {
      throw mismatchError(name, existing, project);
    }
    registry.rooms[name] = bindRoomToTarget({
      room: existing,
      name,
      target,
      project,
      openedReason,
      archivePrevious,
    });
    if (roomTargetVerification) registry.rooms[name].roomTargetVerification = roomTargetVerification;
    if (lastTargetRepair) registry.rooms[name].lastTargetRepair = lastTargetRepair;
    writeRegistry(registry);
    return { name, ...registry.rooms[name] };
  });
}

export function bindChatGptRoomRegistryOnly({
  name,
  conversationUrl,
  targetId = "",
  title = "",
  openedReason = "explicit registry-only rebind",
  verification = "not_verified_registry_only",
} = {}) {
  const project = ensureProjectState();
  if (!name) {
    const error = new Error("Room alias is required.");
    error.errorCode = "session.alias_required";
    throw error;
  }
  const target = targetFromConversationUrl(conversationUrl, { id: targetId, title });
  return withProjectStateLockSync({ project, reason: `rooms:registry-rebind:${name}` }, () => {
    const registry = readRegistry();
    const existing = registry.rooms[name];
    if (existing?.projectId && existing.projectId !== project.projectId) {
      throw mismatchError(name, existing, project);
    }
    registry.rooms[name] = {
      ...bindRoomToTarget({
        room: {
          ...existing,
          projectId: project.projectId,
          repoRoot: project.repoRoot,
          projectDisplayName: project.displayName,
        },
        name,
        target,
        project,
        openedReason,
        archivePrevious: true,
      }),
      roomTargetVerification: verification,
      lastTargetRepair: null,
    };
    writeRegistry(registry);
    return { name, ...registry.rooms[name], registryOnly: true, roomTargetVerification: verification };
  });
}

export async function rebindChatGptSessionAlias(port, { name, targetId, conversationUrl } = {}) {
  if (!name) throw new Error("Session alias name is required.");
  const sessions = await listChatGptSessions(port);
  let target = targetId
    ? sessions.find((session) => session.id === targetId)
    : conversationUrl
      ? sessions.find((session) => session.url === conversationUrl)
      : sessions[0];
  if (!target && conversationUrl) {
    target = targetSummary(await openChatGptTarget(port, conversationUrl), [name]);
  }
  if (!target) throw new Error(`ChatGPT target not found for id/url: ${targetId || conversationUrl || "(first)"}`);
  const project = ensureProjectState();
  return withProjectStateLockSync({ project, reason: `rebind:${name}` }, () => {
    const registry = readRegistry();
    const existing = registry.rooms[name];
    registry.rooms[name] = bindRoomToTarget({
      room: {
        ...existing,
        projectId: project.projectId,
        repoRoot: project.repoRoot,
        projectDisplayName: project.displayName,
      },
      name,
      target,
      project,
      openedReason: "explicit rebind",
      archivePrevious: true,
    });
    registry.rooms[name].roomTargetVerification = "verified_live";
    writeRegistry(registry);
    return { name, ...registry.rooms[name], rebound: true };
  });
}

export async function resolveChatGptSession(port, selector, { allowRebind = false, conversationUrl = "" } = {}) {
  const project = ensureProjectState();
  if (allowRebind && selector && !selector.startsWith("http")) {
    await rebindChatGptSessionAlias(port, { name: selector, conversationUrl });
  }
  const sessions = await listChatGptSessions(port);
  if (!selector) return sessions[0] || null;

  const registry = readRegistry();
  const saved = registry.rooms[selector];
  if (saved) {
    if (saved.projectId !== project.projectId) throw mismatchError(selector, saved, project);
    const byTarget = sessions.find((session) => session.id === saved.targetId);
    if (byTarget) return byTarget;
    const byUrl = sessions.find((session) =>
      session.url === saved.activeConversationUrl
      || session.url === saved.conversationUrl
      || session.url === saved.url,
    );
    if (byUrl) return byUrl;
  }

  return sessions.find((session) => session.id === selector)
    || sessions.find((session) => session.aliases.includes(selector))
    || sessions.find((session) => session.url === selector)
    || null;
}

function baseRoomTarget({ project, selector, saved, expectedUrl, threadMode = "continue" }) {
  return {
    projectId: project.projectId,
    alias: selector || null,
    threadMode,
    expectedConversationUrl: expectedUrl || null,
    expectedConversationId: conversationIdFromUrl(expectedUrl),
    savedTargetId: saved?.targetId || null,
    savedTargetUrl: saved?.activeConversationUrl || saved?.conversationUrl || saved?.url || null,
    resolution: "failed",
    verified: false,
    repaired: false,
    repairReason: "none",
    actualTargetId: null,
    actualTargetUrl: null,
    actualConversationId: null,
    targetBoundToRoom: false,
    checkedAt: nowIso(),
  };
}

function finishRoomTarget(roomTarget, target, { resolution, repaired = false, repairReason = "none" } = {}) {
  return {
    ...roomTarget,
    resolution,
    verified: true,
    repaired,
    repairReason,
    actualTargetId: target.id,
    actualTargetUrl: target.url,
    actualConversationId: conversationIdFromUrl(target.url),
    targetBoundToRoom: true,
  };
}

function roomTargetFailure(roomTarget, { errorCode, message, repairReason = "none", target = null }) {
  return roomError(errorCode, message, {
    roomTarget: {
      ...roomTarget,
      repairReason,
      actualTargetId: target?.id || null,
      actualTargetUrl: target?.url || null,
      actualConversationId: conversationIdFromUrl(target?.url),
    },
  });
}

export async function resolveVerifiedRoomTarget(port, selector, {
  allowRebind = false,
  conversationUrl = "",
  threadMode = "continue",
  agentRoom = null,
} = {}) {
  const startedAt = Date.now();
  const project = ensureProjectState();
  if (allowRebind && selector && !selector.startsWith("http")) {
    await rebindChatGptSessionAlias(port, { name: selector, conversationUrl });
  }

  const registry = readRegistry();
  const sessions = await listChatGptSessions(port);
  const saved = selector
    ? registry.rooms[selector] || migrateLegacyRoomAlias({ name: selector, agentRoom })
    : null;
  if (!selector) {
    const target = sessions[0] || null;
    if (!target) return { target: null, room: null, roomTarget: null };
    return {
      target,
      room: null,
      roomTarget: {
        ...finishRoomTarget(baseRoomTarget({ project, selector, saved: null, expectedUrl: target.url, threadMode }), target, {
          resolution: "current_target",
        }),
        durationMs: Date.now() - startedAt,
      },
    };
  }

  if (saved) {
    if (saved.projectId !== project.projectId) throw mismatchError(selector, saved, project);
    const expectedUrl = conversationUrl || saved.activeConversationUrl || saved.conversationUrl || saved.url || "";
    const roomTarget = baseRoomTarget({ project, selector, saved, expectedUrl, threadMode });
    if (!expectedUrl) {
      throw roomTargetFailure(roomTarget, {
        errorCode: "room.conversation_url_missing",
        message: `Room "${selector}" has no active conversation URL.`,
        repairReason: "expected_url_missing",
      });
    }
    const byTarget = sessions.find((session) => session.id === saved.targetId);
    if (!conversationIdFromUrl(expectedUrl)) {
      if (byTarget && conversationIdFromUrl(byTarget.url)) {
        const repairedRoom = await aliasChatGptSession(port, {
          name: selector,
          targetId: byTarget.id,
          openedReason: "recovered canonical URL from provisional target",
          archivePrevious: false,
          roomTargetVerification: "verified_live",
          lastTargetRepair: {
            repairedAt: nowIso(),
            reason: "provisional_url_replaced_by_canonical_target",
            previousUrl: expectedUrl,
            conversationUrl: committedConversationUrl(byTarget.url),
          },
        });
        await activateChatGptSession(port, { targetId: byTarget.id });
        return {
          target: byTarget,
          room: repairedRoom,
          roomTarget: {
            ...finishRoomTarget(roomTarget, byTarget, {
              resolution: "saved_provisional_target_recovered",
              repaired: true,
              repairReason: "provisional_url_replaced_by_canonical_target",
            }),
            durationMs: Date.now() - startedAt,
          },
        };
      }
      throw roomTargetFailure(roomTarget, {
        errorCode: "room.conversation_url_invalid",
        message: `Room "${selector}" has an invalid ChatGPT conversation URL: ${expectedUrl}`,
        repairReason: "expected_url_invalid",
      });
    }

    if (byTarget && sameConversationUrl(byTarget.url, expectedUrl)) {
      await activateChatGptSession(port, { targetId: byTarget.id });
      return {
        target: byTarget,
        room: saved,
        roomTarget: {
          ...finishRoomTarget(roomTarget, byTarget, { resolution: "saved_target_verified" }),
          durationMs: Date.now() - startedAt,
        },
      };
    }
    const repairReason = byTarget
      ? "saved_target_url_mismatch"
      : saved.targetId
        ? "saved_target_closed"
        : "saved_target_missing";
    const byUrl = sessions.find((session) => sameConversationUrl(session.url, expectedUrl));
    if (byUrl) {
      await activateChatGptSession(port, { targetId: byUrl.id });
      return {
        target: byUrl,
        room: saved,
        roomTarget: {
          ...finishRoomTarget(roomTarget, byUrl, {
            resolution: "found_matching_open_target",
            repaired: true,
            repairReason,
          }),
          durationMs: Date.now() - startedAt,
        },
      };
    }

    const opened = await openChatGptTarget(port, expectedUrl);
    return {
      target: targetSummary(opened, [selector]),
      room: saved,
      roomTarget: {
        ...finishRoomTarget(roomTarget, opened, {
          resolution: "opened_expected_url",
          repaired: true,
          repairReason: repairReason === "none" ? "expected_url_not_open" : repairReason,
        }),
        durationMs: Date.now() - startedAt,
      },
    };
  }

  const directTarget = sessions.find((session) => session.id === selector)
    || sessions.find((session) => session.aliases.includes(selector))
    || sessions.find((session) => sameConversationUrl(session.url, selector))
    || null;
  if (directTarget) {
    await activateChatGptSession(port, { targetId: directTarget.id });
    return {
      target: directTarget,
      room: null,
      roomTarget: {
        ...finishRoomTarget(baseRoomTarget({ project, selector, saved: null, expectedUrl: directTarget.url, threadMode }), directTarget, {
          resolution: "direct_target",
        }),
        durationMs: Date.now() - startedAt,
      },
    };
  }

  return { target: null, room: null, roomTarget: null };
}

export async function activateChatGptSession(port, { name, targetId } = {}) {
  const target = targetId
    ? (await listChatGptSessions(port)).find((session) => session.id === targetId)
    : await resolveChatGptSession(port, name);
  if (!target) throw new Error(`ChatGPT session not found: ${name || targetId || "(first)"}`);
  await fetch(`http://127.0.0.1:${port}/json/activate/${target.id}`);
  return target;
}

export async function closeChatGptSession(port, { name, targetId } = {}) {
  const target = targetId
    ? (await listChatGptSessions(port)).find((session) => session.id === targetId)
    : await resolveChatGptSession(port, name);
  if (!target) throw new Error(`ChatGPT session not found: ${name || targetId || "(first)"}`);
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return target;
}

export async function connectToChatGptSession(port, selector, { allowRebind = false, conversationUrl = "", agentRoom = null } = {}) {
  const resolved = await resolveVerifiedRoomTarget(port, selector, { allowRebind, conversationUrl, agentRoom });
  const target = resolved.target;
  if (!target) throw new Error(`ChatGPT session not found: ${selector || "(first)"}`);
  await activateChatGptSession(port, { targetId: target.id });
  const cdp = await CdpSession.open(target.webSocketDebuggerUrl);
  return { cdp, target, room: resolved.room, roomTarget: resolved.roomTarget };
}

function capRecentRuns(runs) {
  return runs.slice(0, RECENT_RUN_LIMIT);
}

export function recordFreshThread({ aliasHint, target, runId, receiptPath, transcriptPath } = {}) {
  const project = ensureProjectState();
  const committedTarget = targetFromConversationUrl(target?.url, {
    id: target?.id,
    title: target?.title,
    webSocketDebuggerUrl: target?.webSocketDebuggerUrl,
  });
  return withProjectStateLockSync({ project, reason: "record-fresh-thread" }, () => {
    const registry = readRegistry();
    const entry = {
      threadId: targetThreadId(committedTarget),
      conversationUrl: committedTarget.url,
      aliasHint: aliasHint || null,
      runId: runId || null,
      receiptPath: receiptPath || null,
      transcriptPath: transcriptPath || null,
      createdAt: nowIso(),
      projectId: project.projectId,
      repoRoot: project.repoRoot,
    };
    registry.freshThreads = [entry, ...registry.freshThreads].slice(0, RECENT_RUN_LIMIT);
    writeRegistry(registry);
    return entry;
  });
}

export function recordChatGptAliasUse({ name, target, runId, receiptPath, transcriptPath, agentRoom = null } = {}) {
  if (!name) return null;
  const project = ensureProjectState();
  const committedTarget = target
    ? targetFromConversationUrl(target.url, {
        id: target.id,
        title: target.title,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      })
    : null;
  return withProjectStateLockSync({ project, reason: `record-alias-use:${name}` }, () => {
    const registry = readRegistry();
    let saved = registry.rooms[name]
      || migrateLegacyRoomAliasInRegistry(registry, { name, agentRoom, project });
    if (!saved && !committedTarget) return null;
    if (committedTarget) {
      saved = bindRoomToTarget({
        room: saved,
        name,
        target: committedTarget,
        project,
        openedReason: saved ? "record committed call target" : "first committed call target",
        archivePrevious: true,
      });
      registry.rooms[name] = saved;
    }
    if (saved.projectId !== project.projectId) throw mismatchError(name, saved, project);
    const timestamp = nowIso();
    const activeThreadId = saved.activeThreadId;
    const activeConversationUrl = saved.activeConversationUrl;
    const recentRun = {
      runId: runId || saved.lastRunId || null,
      receiptPath: receiptPath || saved.lastReceiptPath || null,
      transcriptPath: transcriptPath || saved.lastTranscriptPath || null,
      createdAt: timestamp,
    };
    const lineage = saved.lineage.map((entry) => entry.threadId === activeThreadId
      ? {
          ...entry,
          lastRunId: runId || entry.lastRunId || null,
          firstRunId: entry.firstRunId || runId || null,
          lastReceiptPath: receiptPath || entry.lastReceiptPath || null,
        }
      : entry);
    registry.rooms[name] = {
      ...saved,
      requestedAlias: agentRoom?.requestedAlias || saved.requestedAlias || name,
      scope: agentRoom?.scope || saved.scope || "legacy",
      agentScoped: agentRoom ? agentRoom.agentScoped === true : saved.agentScoped || false,
      taskScoped: agentRoom ? agentRoom.taskScoped === true : saved.taskScoped || false,
      agent: agentRoom?.agent || saved.agent || null,
      task: agentRoom?.task || saved.task || null,
      taskTitle: agentRoom?.taskTitle || saved.taskTitle || "",
      roomLabel: agentRoom?.roomLabel || saved.roomLabel || "",
      targetId: committedTarget?.id || saved.targetId || null,
      activeThreadId,
      activeConversationUrl,
      conversationUrl: activeConversationUrl,
      url: activeConversationUrl,
      title: committedTarget?.title || saved.title || "",
      lastUsedAt: timestamp,
      updatedAt: timestamp,
      lastRunId: runId || saved.lastRunId || null,
      lastReceiptPath: receiptPath || saved.lastReceiptPath || null,
      lastTranscriptPath: transcriptPath || saved.lastTranscriptPath || null,
      callCount: Number(saved.callCount || 0) + 1,
      recentRuns: capRecentRuns([recentRun, ...(saved.recentRuns || [])]),
      lineage,
    };
    writeRegistry(registry);
    return registry.rooms[name];
  });
}
