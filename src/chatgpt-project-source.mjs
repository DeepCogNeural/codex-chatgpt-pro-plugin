import { resolve } from "node:path";
import { evaluate, sleep } from "./cdp-client.mjs";
import { stageUploadFiles } from "./chatgpt-upload.mjs";

export const PROJECT_SOURCE_INPUT_CANDIDATE_SELECTOR = "input[type='file']:not(#upload-files)";
export const PROJECT_SOURCE_TARGET_ATTR = "data-codex-project-source-target";

function projectSourceError(errorCode, message, details = {}) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

async function clickUploadEntrypoint(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const composer = document.querySelector("#prompt-textarea");
      const composerForm = composer?.closest("form") || null;
      const candidates = [...document.querySelectorAll("button, [role='button'], a")]
        .filter(visible)
        .filter((el) => !composerForm || !composerForm.contains(el))
        .map((el) => {
          const label = [
            el.innerText,
            el.getAttribute("aria-label"),
            el.title,
            el.getAttribute("data-testid"),
          ].filter(Boolean).join(" ").trim();
          return { el, label };
        })
        .filter(({ label }) => /add files|upload files|upload file|add source|sources|knowledge|files/i.test(label));
      const target = candidates[0]?.el || null;
      if (!target) return { clicked: false, labels: candidates.map((item) => item.label) };
      target.click();
      return { clicked: true, label: candidates[0].label };
    })()`,
  ).catch((error) => ({ clicked: false, error: String(error?.message || error) }));
}

async function projectSourceFileInputNodeId(cdp, { entrypointClicked = false } = {}) {
  const marker = `codex-project-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marked = await evaluate(
    cdp,
    `(() => {
      const marker = ${JSON.stringify(marker)};
      const candidateSelector = ${JSON.stringify(PROJECT_SOURCE_INPUT_CANDIDATE_SELECTOR)};
      const composer = document.querySelector("#prompt-textarea");
      const composerForm = composer?.closest("form") || null;
      const textOf = (value) => String(value || "").trim();
      const contextFor = (el) => {
        const parts = [];
        let node = el;
        for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
          parts.push(
            textOf(node.id),
            textOf(node.className),
            textOf(node.getAttribute?.("aria-label")),
            textOf(node.getAttribute?.("data-testid")),
            textOf(node.innerText).slice(0, 300),
          );
        }
        return parts.filter(Boolean).join(" ").slice(0, 1000);
      };
      const candidates = [...document.querySelectorAll(candidateSelector)]
        .filter((el) => !composerForm || !composerForm.contains(el))
        .map((el) => {
          const context = contextFor(el);
          const sourceLike = /project|source|knowledge/i.test(context);
          return { el, context, sourceLike };
        });
      const preferred = candidates.find((item) => item.sourceLike) || (${entrypointClicked ? "candidates[0]" : "null"});
      if (!preferred) {
        return {
          ok: false,
          reason: "missing_non_composer_project_source_input",
          candidateCount: candidates.length,
          entrypointClicked: ${entrypointClicked ? "true" : "false"},
          contexts: candidates.map((item) => item.context).slice(0, 5),
        };
      }
      preferred.el.setAttribute(${JSON.stringify(PROJECT_SOURCE_TARGET_ATTR)}, marker);
      return {
        ok: true,
        selector: \`${PROJECT_SOURCE_INPUT_CANDIDATE_SELECTOR}[${PROJECT_SOURCE_TARGET_ATTR}="\${marker}"]\`,
        candidateCount: candidates.length,
        sourceLike: preferred.sourceLike,
        context: preferred.context,
      };
    })()`,
  );
  if (!marked.ok) {
    throw projectSourceError("project_source.file_input_missing", "No safe Project source file input was found outside the ChatGPT composer.", marked);
  }
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: marked.selector });
  if (!nodeId) {
    throw projectSourceError("project_source.file_input_missing", "The marked Project source file input disappeared before upload.", marked);
  }
  return { nodeId, selector: marked.selector, candidateCount: marked.candidateCount, sourceLike: marked.sourceLike };
}

async function waitForSourceEvidence(cdp, files, { timeoutMs = 90_000 } = {}) {
  const names = files.map((file) => file.name);
  const startedAt = Date.now();
  let lastEvidence = null;
  while (Date.now() - startedAt < timeoutMs) {
    const evidence = await evaluate(
      cdp,
      `(() => {
        const composer = document.querySelector("#prompt-textarea");
        const composerForm = composer?.closest("form") || null;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const textNodes = [];
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        while (walker.nextNode() && textNodes.length < 3000) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent) continue;
          if (composerForm && composerForm.contains(parent)) continue;
          if (!visible(parent)) continue;
          const text = node.nodeValue.trim();
          if (text) textNodes.push(text);
        }
        const bodyText = textNodes.join("\\n");
        const chips = [...document.querySelectorAll("[data-testid*='file'], [aria-label*='file' i], [class*='file'], li, button")]
          .filter(visible)
          .filter((el) => !composerForm || !composerForm.contains(el))
          .map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim())
          .filter(Boolean)
          .slice(0, 200);
        return { bodyText, chips };
      })()`,
    );
    const haystack = [evidence.bodyText || "", ...(evidence.chips || [])].join("\n");
    const visibleFileNames = names.filter((name) => haystack.includes(name));
    lastEvidence = {
      visibleFileNames,
      chipCount: evidence.chips?.length || 0,
      bodyTextChars: (evidence.bodyText || "").length,
    };
    if (visibleFileNames.length === names.length) {
      return { ok: true, matchedBy: "visible_filename", evidence: lastEvidence };
    }
    if (/uploading|processing|indexing|adding/i.test(haystack)) {
      await sleep(1500);
      continue;
    }
    await sleep(750);
  }
  return { ok: false, matchedBy: "timeout", evidence: lastEvidence };
}

export async function uploadProjectSourceFiles(cdp, paths, {
  stageDir,
  timeoutMs = 90_000,
} = {}) {
  const files = stageUploadFiles(paths, { stageDir });
  if (!files.length) return { ok: true, files: [], inputSelector: null, evidence: null };

  await cdp.send("DOM.enable").catch(() => {});
  const entrypoint = await clickUploadEntrypoint(cdp);
  if (entrypoint.clicked) await sleep(750);

  const input = await projectSourceFileInputNodeId(cdp, { entrypointClicked: entrypoint.clicked });
  await cdp.send("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: files.map((file) => resolve(file.path)),
  });
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(${JSON.stringify(input.selector)});
      if (!input) return false;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  ).catch(() => {});

  const evidence = await waitForSourceEvidence(cdp, files, { timeoutMs });
  if (!evidence.ok) {
    throw projectSourceError("project_source.upload_not_observed", "Project source files were set, but uploaded file names were not observed.", {
      files,
      entrypoint,
      inputSelector: input.selector,
      evidence,
    });
  }

  return {
    ok: true,
    files,
    entrypoint,
    inputSelector: input.selector,
    evidence,
  };
}
