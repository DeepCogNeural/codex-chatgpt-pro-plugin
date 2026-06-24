# TASK_STATE

## Goal

Update `codex-chatgpt-pro-plugin` from upstream, then make the daily Codex -> ChatGPT Pro workflow reliable:

- When a ChatGPT Project is specified, open a new conversation inside that Project by default.
- Reuse an old room/conversation only when explicitly requested.
- Prefer the latest ChatGPT Pro Extended / highest Pro reasoning level by default, with safe fallback if the UI label changes.
- Never interrupt ChatGPT while it is thinking, reading documents, finalizing, or otherwise in an active run.
- Require prompts to ask ChatGPT to end with `输出完毕`; Codex may continue only after the active run is finished and that marker is present.
- Support or clearly gate creating a new ChatGPT Project and uploading background files to Project source/knowledge.
- Commit and push the result to the user's own GitHub fork/remote.

## Current Facts

- Source repo: `/Users/linghao/Github/codex-chatgpt-pro-plugin`
- Working branch: `codex/chatgpt-pro-daily-project-workflow`
- Upstream remote currently named `origin`: `https://github.com/pauljunsukhan/codex-chatgpt-pro-plugin.git`
- Upstream `origin/main` was already current at `0cc5c5509ebaccfc7dad45b9e02a0f86407c817c`.
- Upstream branch `origin/bug/fresh-chat-login-skill-flow` was fast-forward merged; it adds bug reproduction artifacts under `bug-reports/2026-06-22-fresh-chat-login-skill-flow/`.
- Pre-existing local dirty changes before this task touched:
  - `bin/chatgpt-pro`
  - `plugins/codex-chatgpt-pro-plugin/bin/chatgpt-pro`
  - `scripts/plugin-install-smoke.mjs`
  - `plugins/codex-chatgpt-pro-plugin/scripts/plugin-install-smoke.mjs`

## Commands / Results

- `git fetch --all --prune`: fetched upstream branch `bug/fresh-chat-login-skill-flow`.
- `git switch -c codex/chatgpt-pro-daily-project-workflow`: created feature branch.
- `git merge --no-edit origin/bug/fresh-chat-login-skill-flow`: fast-forward merged upstream bug artifacts.
- `npm run test:call-policy`: passed.
- `npm run test:project-source-gate`: passed.
- `npm run test:non-interference`: passed.
- `npm run plugin:sync`: copied source changes into `plugins/codex-chatgpt-pro-plugin`.
- `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- Independent review found two P1 issues:
  - message attachments were scoped too broadly by ChatGPT Project URL, so a new conversation in the same Project could incorrectly skip a needed attachment.
  - message attachment ledger was written before the user message was verified, so a later send failure could leave a false uploaded record.
- Fixed message attachment dedupe to use only real ChatGPT `/c/...` conversation URLs. New Project conversations without a conversation URL upload normally and do not skip.
- Fixed message attachment ledger recording to happen in `scripts/chatgpt-call.mjs` only after `waitForNewUserMessage` verifies the sent user message.
- Fixed Project source evidence so visible filename alone is not enough while `uploading` / `processing` / `indexing` / duplicate-upload errors are visible.
- Added tests for same Project / different conversation not skipping, Project URL without `/c/...` not producing a message scope, and Project source processing/error states not being treated as settled success.
- Independent review found the active-run guard should wait instead of failing immediately. Fixed by adding `waitForNoActiveGeneration` before upload, typing, and send.
- Re-ran `npm run plugin:sync && npm run test:deterministic && git diff --check`: passed.
- Independent review then found choice/model menu handling also needed to wait before touching the UI. Fixed by adding `wait-active-run-before-choices`.
- Re-ran `npm run plugin:sync && npm run test:deterministic && git diff --check`: passed.
- Independent review then found `--reuse-room` needed to override `CHATGPT_NEW_CHAT=1`. Fixed in `resolveThreadPolicy` and added coverage to `test:call-policy`.
- Re-ran `npm run plugin:sync && npm run test:deterministic && git diff --check`: passed.
- Independent review then found active-run state read errors must not be treated as idle, and unrelated `final line must ...` prompts must not suppress marker injection. Fixed both and added marker coverage to `test:call-policy`.
- Re-ran `npm run plugin:sync && npm run test:deterministic && git diff --check`: passed.
- Independent review then found `project-source upload` could still mistake an ordinary message attachment input for Project source/knowledge upload. Fixed it fail-closed: the uploader only targets non-composer Project source inputs, marks the exact input before setting files, dispatches events only on that marked input, and ignores composer attachment chips when verifying uploaded file names.
- Re-ran `npm run plugin:sync`: passed.
- Re-ran `npm run test:deterministic`: passed.
- Re-ran `git diff --check`: passed.
- Independent final review returned `PASS`.

## Open Work

- Create or configure user-owned GitHub remote and push.

## Notes

- No real ChatGPT prompt was sent during deterministic verification.
- No real Project source/knowledge upload was performed during deterministic verification.
- Project creation remains fail-closed and documented as not automated yet.
- Project source upload must never fall back to the ordinary ChatGPT composer file input; ordinary `--upload-file` attaches to one message, while `project-source upload` is meant to persist files into the Project knowledge/source area.

## 2026-06-23 Duplicate Upload Follow-Up

### Goal

Stop ChatGPT duplicate-file modals from disrupting agent calls.

### Root Cause

- Prior staging added timestamp metadata, but there was no durable record of what had already been uploaded.
- Agents therefore tried to upload the same content again and relied on modal cleanup after ChatGPT complained.
- This was fragile because duplicate-upload modals can appear while ChatGPT is still showing a useful answer; agents must dismiss only the modal and must not retry, reload, or interrupt the active run.

### Fix

- Added a local upload ledger at `.devspace/state/chatgpt-upload-ledger.json`.
- Upload ledger scope:
  - normal message attachments: actual ChatGPT `/c/...` conversation URL only.
  - Project source uploads: ChatGPT Project URL.
- Same content hash in the same scope is skipped and reported in `receipt.upload.skipped`.
- Changed content gets a staged filename with the new content hash, so ChatGPT sees a new version.
- Project source upload now uses the same ledger before opening the file input.

### Verification

- RED: `npm run test:upload-metadata` failed because `prepareUploadFiles` did not exist.
- GREEN: `npm run test:upload-metadata` passed.
- `npm run test:project-source-gate`: passed.
- `npm run test:call-policy`: passed.
- `npm run test:non-interference`: passed.
- `npm run plugin:sync`: passed.
- `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- Independent reviewer recheck returned `PASS`.

## 2026-06-23 Project Default + Stale Modal Follow-Up

### Goal

Make daily agent calls stop depending on every caller remembering the ChatGPT Project URL, and prevent old duplicate-upload modals from blocking later calls.

### Root Cause Evidence

- A recent failed run under `/Users/linghao/Github/Polymarket-OB-LP/.devspace/runs/2026-06-23T18-08-18-499Z-chatgpt-call/receipt.json` targeted `https://chatgpt.com/` with `chatGptProject.url: null`; that caller did not use the Project.
- The visible duplicate-upload modals were tied to older Project tabs from `17:09` and `17:15` timeout runs. Their staged filenames were timestamp-only, from before the hash/ledger patch.
- Current installed plugin cache already had the upload ledger/hash patch, so the screenshot is stale browser state plus one caller misuse, not direct evidence that the new dedupe code failed.

### Fix

- Added repo-local default Project URL support through git config `chatgpt-pro.projectUrl`.
- Project URL priority is now explicit `--project-url`, then `CHATGPT_PROJECT_URL`, then repo-local `chatgpt-pro.projectUrl`.
- Applied that default to `chatgpt-pro call`, `chatgpt-pro read`, and `chatgpt-pro project-source upload`.
- Added call-start stale upload UI cleanup after active-run wait: dismiss duplicate-upload modal and remove stale composer attachments before selecting model/uploading/typing.
- Updated README, skill docs, and call contract so future agents do not have to infer the Project URL or duplicate-upload behavior.

### Verification

- `npm run test:call-policy`: passed.
- `npm run test:upload-metadata`: passed.
- `npm run test:project-source-gate`: passed.
- `npm run test:non-interference`: passed.
- `npm run plugin:sync`: passed.
- First `npm run test:deterministic` failed at `test:package-surface` because `.codex/skills/chatgpt-pro-line/SKILL.md` was stale relative to `skills/chatgpt-pro-line/SKILL.md`.
- Synchronized the source repo `.codex` skill mirror.
- Re-ran `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- `node --check scripts/chatgpt-call.mjs scripts/chatgpt-read-current.mjs scripts/chatgpt-project-source.mjs src/chatgpt-upload.mjs src/git-config.mjs`: passed.
- Refreshed installed Codex plugin cache with `/Users/linghao/.local/bin/codex --enable plugins plugin add codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin`.
- Verified installed cache contains `chatgpt-pro.projectUrl`, `cleanupStaleUploadUi`, and the updated skill docs.
- Set `/Users/linghao/Github/Polymarket-OB-LP` repo-local git config `chatgpt-pro.projectUrl=https://chatgpt.com/g/g-p-6a35e91256988191b967fe33344b0f04-polymarket-lp`.
- Verified `configuredChatGptProjectUrl()` resolves that Polymarket Project URL when `CHATGPT_REPO_ROOT=/Users/linghao/Github/Polymarket-OB-LP`.
- Cleared two stale duplicate-upload modals in existing ChatGPT Project tabs after confirming no active run; follow-up scan found no remaining duplicate-upload modal targets.

## 2026-06-23 Explicit Duplicate Upload Cleanup Command

### Goal

Give agents a one-command escape hatch when ChatGPT shows `You've already uploaded this file`.

### Fix

- Added `chatgpt-pro cleanup duplicate-upload`.
- The command scans visible ChatGPT tabs and dismisses only duplicate-upload OK modals.
- If ChatGPT generation state is active or unknown, it only dismisses the modal and does not remove attachments.
- If ChatGPT is idle, it also removes stale composer attachments left by older failed upload attempts.
- The cleanup command uses the global live-browser operation lock, so it cannot race normal `call`, `read`, room repair, or history export operations.
- Documented the command in README, the packaged skill, and the call contract.

### Verification

- RED: `node scripts/cleanup-duplicate-upload-selftest.mjs` failed because `src/chatgpt-cleanup.mjs` did not exist.
- GREEN: `npm run test:cleanup-duplicate-upload`: passed.
- `npm run test:public-concurrency`: passed.
- `npm run test:operation-boundary`: passed.
- `npm run test:non-interference`: passed.
- `npm run test:package-surface`: passed.
- Live no-prompt smoke: `./bin/chatgpt-pro cleanup duplicate-upload` scanned 13 ChatGPT tabs and returned `cleaned: 0`.
- `npm run plugin:sync`: passed.
- `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- `node --check scripts/chatgpt-cleanup.mjs src/chatgpt-cleanup.mjs bin/chatgpt-pro`: passed.
- Refreshed installed Codex plugin cache with `/Users/linghao/.local/bin/codex --enable plugins plugin add codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin`.
- Installed-cache no-prompt smoke: `/Users/linghao/.codex/plugins/cache/codex-chatgpt-pro-plugin/codex-chatgpt-pro-plugin/0.1.0/bin/chatgpt-pro cleanup duplicate-upload` scanned 13 ChatGPT tabs and returned `cleaned: 0`.

## 2026-06-23 Agent-Scoped Room Isolation

### Goal

Prevent different Codex agents from accidentally sharing the same ChatGPT Project conversation when they pass the same logical alias such as `main`, `critic`, or `polymarket-lp`.

### Fix

- Added agent-room policy resolution.
- A logical alias now resolves to an effective alias by default: `<alias>--agent-<agent-slug>`.
- Agent identity priority: explicit `--agent-id`, `CHATGPT_AGENT_ID`, `CODEX_AGENT_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, then `AGENT_ID`.
- `chatgpt-pro call` now defaults to logical alias `main` when a ChatGPT Project URL is configured but no alias is passed, so Project calls get a tracked room instead of an unbound tab.
- `call`, `read`, `history export`, and `status` all resolve aliases the same way, so the same agent can reuse its own room.
- `--shared-room` / `CHATGPT_SHARED_ROOM=1` is the explicit escape hatch for deliberate cross-agent sharing.
- Room registry now records `requestedAlias`, `agentScoped`, `agent`, `taskTitle`, and `roomLabel`.
- After a successful `call`, the browser tab title is best-effort labeled with the concise room label. The registry and receipt remain the durable source of truth.
- README, packaged skill, and call contract now document the rule.

### Verification

- RED: `node scripts/agent-room-policy-selftest.mjs` failed because `src/agent-room-policy.mjs` did not exist.
- GREEN: `npm run test:agent-room-policy`: passed.
- `npm run test:session-lineage`: passed.
- `npm run test:status`: passed.
- `npm run test:package-surface`: passed.
- No-browser CLI smoke:
  - `./bin/chatgpt-pro status --alias=main --agent-id=agent-a` resolved alias `main--agent-agent-a`.
  - `./bin/chatgpt-pro status --alias=main --agent-id=agent-b` resolved alias `main--agent-agent-b`.
  - `./bin/chatgpt-pro status --alias=main --agent-id=agent-a --shared-room` resolved alias `main`.
- `npm run plugin:sync`: passed.
- `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- `node --check scripts/chatgpt-call.mjs scripts/chatgpt-read-current.mjs scripts/chatgpt-history.mjs scripts/chatgpt-status.mjs src/agent-room-policy.mjs src/chatgpt-sessions.mjs`: passed.

## 2026-06-23 Upload-Path Duplicate Modal Auto Cleanup

### Goal

Handle duplicate-upload modals inside the normal upload flow, not only through a manual cleanup command.

### Fix

- Kept the upstream prevention layer: upload ledger skips same content in the same valid scope, and staged filenames include the original content hash.
- Added upload evidence classification so the upload loop can distinguish a duplicate-upload modal from a real uploading/processing state.
- During upload evidence polling, if ChatGPT shows the duplicate-upload modal, the wrapper dismisses only that modal and keeps waiting for upload evidence.
- After upload evidence is collected, the wrapper checks for the duplicate-upload modal once more and dismisses it so it cannot cover the composer or send button.
- Upload receipts now include `cleanup.duplicateUploadDialogDuringUpload` and `cleanup.postUploadDuplicateDialog`.
- Fixed a classification edge case where `already uploaded` / `Try uploading something new` was incorrectly treated as an active uploading state.

### Verification

- RED: `npm run test:upload-metadata` failed because `classifyUploadEvidence` did not exist.
- GREEN: `npm run test:upload-metadata`: passed.
- `npm run test:cleanup-duplicate-upload`: passed.
- `npm run test:package-surface`: passed.
- `npm run test:non-interference`: passed.
- `npm run plugin:sync`: passed.
- `npm run test:deterministic`: passed.
- `git diff --check`: passed.
- `node --check src/chatgpt-upload.mjs scripts/upload-metadata-selftest.mjs`: passed.

## 2026-06-23 Task-Scoped ChatGPT Project Conversations

### Goal

Keep using one ChatGPT Project as the workspace, but prevent different Codex
tasks from sharing the same ChatGPT conversation by accident.

### Correction

- Agent-scoped rooms were not strict enough: the same Codex agent could start a
  later task and reuse the previous task's conversation alias.
- The default scope is now Codex task, not agent.
- Effective aliases now include task identity:
  `<logical-alias>--task-<task-slug>--agent-<agent-slug>`.
- Task identity priority is `--task-id`, `CHATGPT_TASK_ID`, `CODEX_TASK_ID`,
  `CODEX_GOAL_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, then prompt/task
  title hash.
- `--shared-room` remains the explicit escape hatch for intentionally sharing a
  conversation across tasks or agents.
- Follow-up within the same task should pass the same `--task-id` plus
  `--reuse-room`.

### Verification

- RED: `node scripts/agent-room-policy-selftest.mjs` failed because
  `resolveTaskIdentity` did not exist.
- GREEN: `node scripts/agent-room-policy-selftest.mjs` passed.

## 2026-06-24 Project New Conversation Active-State Fix

### Goal

Make `chatgpt-pro call` reliably open and use a new conversation inside the
configured ChatGPT Project.

### Root Cause

- Several failed Project calls opened a Project tab, but the room stayed bound
  to the Project home URL ending in `/project` instead of a real conversation
  URL under `/c/...`.
- The failing step was `wait-active-run-before-choices`.
- Receipt evidence showed the only active label was
  `Open conversation options for LP resize/cancel review`.
- The active-run detector matched any button label containing `cancel`, so a
  normal conversation title containing `resize/cancel` was treated as an active
  ChatGPT generation. The wrapper waited until timeout and never sent the first
  message that would create the new Project conversation.

### Fix

- Added a deterministic generation-state selftest.
- `generationState()` now only treats explicit generation controls/statuses as
  active: `Stop answering`, `Stop generating`, `Interrupt`, `Pro thinking`,
  `Reading documents`, and `Finalizing answer`.
- Ordinary conversation option labels containing words like `cancel` no longer
  block Project calls.

### Verification

- RED: `npm run test:generation-state` failed because the new helper exports
  did not exist.
- GREEN: `npm run test:generation-state`: passed.
- `npm run test:cleanup-duplicate-upload`: passed.
- `npm run test:non-interference`: passed.
- Live check on existing ChatGPT Project home returned `generationState.active:
  false`.
- Live smoke:
  `chatgpt-pro call --alias=polymarket-lp --task-id=codex-project-new-convo-smoke-20260624 ...`
  passed and created
  `https://chatgpt.com/g/g-p-6a35e91256988191b967fe33344b0f04-polymarket-lp/c/6a3b2b96-bd5c-83ea-a4af-949750535b3e`.
