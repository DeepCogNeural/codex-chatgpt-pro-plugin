import { buildChatGptStatus } from "../src/chatgpt-status.mjs";
import { resolveAgentRoom } from "../src/agent-room-policy.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const requestedAlias = arg("alias") || arg("session") || process.env.CHATGPT_SESSION || "main";
const agentRoom = resolveAgentRoom({
  requestedAlias,
  explicitAgentId: arg("agent-id") || process.env.CHATGPT_AGENT_ID || "",
  sharedRoom: flag("shared-room") || /^(1|true|yes)$/i.test(process.env.CHATGPT_SHARED_ROOM || ""),
});
const alias = agentRoom.effectiveAlias;

try {
  if (process.argv.includes("--live")) {
    const error = new Error("status --live is not implemented yet. Use chatgpt-pro doctor --live once package-shell doctor lands.");
    error.errorCode = "mode.unsupported";
    throw error;
  }
  console.log(JSON.stringify({
    ...buildChatGptStatus({ alias }),
    roomResolution: {
      alias,
      requestedAlias: agentRoom.requestedAlias || null,
      agentScoped: agentRoom.scoped,
      agent: agentRoom.agent,
    },
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    command: "status",
    errorCode: error?.errorCode || "status.failed",
    error: String(error?.message || error),
  }, null, 2));
  process.exit(1);
}
