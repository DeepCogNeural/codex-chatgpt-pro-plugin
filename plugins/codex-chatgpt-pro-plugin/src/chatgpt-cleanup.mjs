import { DEFAULT_CDP_PORT } from "./runtime-config.mjs";
import { CdpSession, evaluate } from "./cdp-client.mjs";
import { generationState } from "./chatgpt-composer.mjs";
import {
  cleanupStaleUploadUi,
  dismissDuplicateUploadDialog,
} from "./chatgpt-upload.mjs";

export function isDuplicateUploadModalText(text = "") {
  return /already uploaded this file|try uploading something new/i.test(String(text || ""));
}

export function cleanupModeForGenerationState(state = {}) {
  return {
    dismissDuplicateModal: true,
    removeStaleAttachments: state?.active === false,
  };
}

async function chatGptTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`Chrome CDP target list failed: ${response.status}`);
  const targets = await response.json();
  return targets.filter((target) => String(target.url || "").startsWith("https://chatgpt.com/"));
}

async function targetHasDuplicateUploadModal(cdp) {
  return evaluate(
    cdp,
    `(() => /already uploaded this file|try uploading something new/i.test(document.body?.innerText || ""))()`,
  ).catch(() => false);
}

export async function cleanupDuplicateUploadModals({
  port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT),
} = {}) {
  const targets = await chatGptTargets(port);
  const results = [];

  for (const target of targets) {
    const cdp = await CdpSession.open(target.webSocketDebuggerUrl).catch(() => null);
    if (!cdp) {
      results.push({ id: target.id, url: target.url, skipped: true, reason: "cdp_open_failed" });
      continue;
    }
    try {
      await cdp.send("Runtime.enable").catch(() => {});
      await cdp.send("DOM.enable").catch(() => {});
      const hasDuplicateModal = await targetHasDuplicateUploadModal(cdp);
      if (!hasDuplicateModal) continue;

      const state = await generationState(cdp).catch(() => ({ active: null, labels: ["state_read_failed"] }));
      const mode = cleanupModeForGenerationState(state);
      const cleanup = mode.removeStaleAttachments
        ? await cleanupStaleUploadUi(cdp)
        : {
            dismissedDialog: await dismissDuplicateUploadDialog(cdp),
            removedExisting: { removed: 0, skipped: "active_or_unknown_generation_state" },
          };

      results.push({
        id: target.id,
        url: target.url,
        title: target.title || "",
        active: state.active,
        activeLabels: state.labels || [],
        cleanupMode: mode,
        cleanup,
      });
    } finally {
      await cdp.close().catch(() => {});
    }
  }

  return {
    ok: true,
    checked: targets.length,
    cleaned: results.filter((result) => result.cleanup?.dismissedDialog?.dismissed).length,
    results,
  };
}
