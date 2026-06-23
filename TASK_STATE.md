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
  - normal message attachments: ChatGPT Project URL when present, otherwise conversation URL or alias.
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
