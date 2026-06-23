import { spawnSync } from "node:child_process";
import { repoRoot } from "./runtime-config.mjs";

export function gitConfigValue(name) {
  const result = spawnSync("git", ["config", "--local", "--get", name], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function configuredChatGptProjectUrl() {
  return gitConfigValue("chatgpt-pro.projectUrl")
    || gitConfigValue("chatgpt-pro.chatGptProjectUrl")
    || "";
}
