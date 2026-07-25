# ChatGPT Pro Line

**A Codex plugin that gives your agent a direct line to a logged-in ChatGPT Pro session.**

Codex is great at execution. For the hard parts — architecture, system design,
research synthesis, tradeoff calls, gnarly debugging strategy — you sometimes
want a second, stronger brain. ChatGPT Pro Line lets a Codex agent phone that
brain: it drives a real, logged-in **ChatGPT Pro** browser session, attaches
your repo as context, sends a message, reads the answer, and writes a receipt —
**no API key, no password handling, no scraped cookies.**

It's a phone line, not a scraper.

## Demo

ChatGPT Pro line call:

[![ChatGPT Pro line demo](docs/assets/chatgpt-pro-line-demo.gif)](docs/assets/chatgpt-pro-line-demo.mp4)

Repo monofile attachment:

[![Repo monofile attach demo](docs/assets/repo-monofile-attach.gif)](docs/assets/repo-monofile-attach.mp4)

## Why

The strongest ChatGPT Pro reasoning isn't exposed on the API — it lives in the
website. So this bridges to the website, deliberately and safely. The human
stays logged in; the automation is text-only and deterministic; and every call
is recorded to disk. You get Pro-level collaboration inside your Codex loop
without handing an agent your credentials.

Use it for high-leverage work — architecture, specs, feature design, research
synthesis, tradeoff review, cross-repo planning, and hard debugging strategy.
Don't spend the line on trivial syntax checks.

## Major features

- **Repo- and task-scoped rooms.** ChatGPT conversations are bound to your git
  repo and, by default, to the current Codex task. A logical alias such as
  `critic` becomes an effective room like
  `critic--task-<codex-task>--agent-<agent>`, so separate tasks do not reuse
  each other's ChatGPT conversation by accident.
- **Repo-as-context, in one file.** Generates a repomix-style `repo-context.md`
  monofile (source tree, LOC, file bodies, line-range source map, hashes), blocks
  secret-like paths/content before writing it, and uploads it only after explicit
  confirmation.
- **One persistent, logged-in profile.** A dedicated Chrome profile keeps you
  logged in across calls and exposes CDP on `127.0.0.1:9222` for deterministic
  control.
- **Multi-agent safe.** A global browser-profile lock serializes every call, so
  concurrent Codex agents never collide in the same ChatGPT window.
- **Receipts + verbatim thread-echo.** Every call records the exact prompt and
  response (with SHA-256 hashes), selected model/intelligence, lock timing,
  conversation URL, a screenshot, and network/console logs.
- **Visible history export.** Pull a bound room's visible ChatGPT history to
  disk and reread it later without touching the browser — handy for picking up a
  human-started thread.

## Install

As a Codex plugin, from a local checkout:

```bash
npm install
npm run plugin:sync
codex --enable plugins plugin marketplace add "$PWD"
codex --enable plugins plugin add codex-chatgpt-pro-plugin@codex-chatgpt-pro-plugin
```

For source development, run the CLI directly:

```bash
./bin/chatgpt-pro init
./bin/chatgpt-pro doctor --warm    # open the dedicated ChatGPT browser
# complete the visible login if prompted
./bin/chatgpt-pro doctor --live    # verify login, composer, and model state
```

If `doctor --live` reports `auth.login_required` (exit code `20`), finish login
in the visible window and rerun `chatgpt-pro doctor --live`.

## Quick start

```bash
# First call into this repo's main room
chatgpt-pro call --alias=main --confirm-repo-context-upload --prompt="Review this repo's architecture and name the biggest risk."

# Configure this repo once so agents do not need to remember the Project URL
git config --local chatgpt-pro.projectUrl https://chatgpt.com/g/...

# Daily advisor flow: uses the configured ChatGPT Project and opens this task's own conversation
chatgpt-pro call --alias=polymarket-lp --task-id=lp-release-review --prompt-file=advisor.md

# Reuse this same task's bound conversation only when continuity is intended
chatgpt-pro call --alias=polymarket-lp --task-id=lp-release-review --reuse-room --prompt-file=follow-up.md

# Deliberately share the exact alias across tasks/agents only when that is intended
chatgpt-pro call --alias=polymarket-lp --shared-room --reuse-room --prompt-file=follow-up.md

# Inspect repo room / lock / cache state without touching the browser
chatgpt-pro status --alias=main

# Open a clean, independent critic room and review a file
chatgpt-pro call --alias=critic --new --prompt-file=review.md

# Bind a ChatGPT thread you started by hand, then pull its history
chatgpt-pro rooms rebind --alias=spec --conversation-url=https://chatgpt.com/c/...
chatgpt-pro history export --alias=spec --last=20

# Re-point or fix a room's target after drift
chatgpt-pro rooms repair --alias=main

# If ChatGPT shows "You've already uploaded this file", dismiss it safely
chatgpt-pro cleanup duplicate-upload
```

Room lifecycle commands (`rooms new`, `rooms rebind`, `rooms repair`, and
`rooms list/show`) are repo-scoped, so the same alias can exist safely in
different repositories.
`rooms new` may open an empty target, but it does not write that target to the
registry until ChatGPT assigns a committed conversation URL. For a new room
that must be usable immediately, prefer `call --new`: after the prompt is sent,
the CLI waits for the real `/c/{id}` URL and only then records the alias.

By default, `call` asks for the best available Pro reasoning level, preferring
`Pro Extended` and falling back to `Pro` when the live UI exposes only that
label. It also appends a hard completion instruction: ChatGPT must end with a
final line that is exactly `输出完毕`. Codex treats the call as incomplete until
the active run is finished and that marker is present. If the page is still
showing `Pro thinking`, `Reading documents`, `Finalizing answer`, `Stop
answering`, `Stop generating`, or `Interrupt`, the CLI waits or fails closed;
it must not stop, reload, retry, resend, or type over the active run.

中文硬规则：ChatGPT 思考、读文档、收尾时绝不打断；必须等它输出完成，并要求末尾明确写
`输出完毕`，Codex 看到这个 marker 后才继续。

If a call returns `chatgpt.response_timeout` after `verified-user-message` or
`assistant-started`, the prompt was already sent. Do not resend it. Continue the
same ChatGPT conversation with the exact same logical room and task id:

```bash
chatgpt-pro read --alias=polymarket-lp --task-id=lp-release-review
```

`read` recovers the saved `sentUserMessage` anchor from the latest
`chatgpt-pro call` receipt for that room, then reads only the assistant output
after that exact user message. If the anchor is missing, ambiguous, or points
at a different conversation, it fails closed instead of returning an old answer.
The normal response budget is 15 minutes so Deep Research can finish without
being mistaken for a lost response. ChatGPT's provisional `/c/WEB:...` URL is
never treated as a conversation identity, upload scope, or registry binding.
If a sent prompt cannot be written back to the room registry, the receipt exits
non-zero, sets `doNotResend: true`, and keeps the real `conversationUrl` for
manual recovery.
If the newest call receipt for that room is missing or unreadable, `read` fails
closed instead of falling back to an older call receipt.

Use `read --help` for usage; help commands are registry/CLI-only and must not
touch the browser.

Project URL priority is explicit `--project-url`, then `CHATGPT_PROJECT_URL`,
then the repo-local git config `chatgpt-pro.projectUrl`. When a Project URL is
available, `call` keeps that same ChatGPT Project but scopes the conversation
by Codex task. A logical alias such as `main` or `polymarket-lp` resolves to an
effective task room like
`polymarket-lp-<hash>--task-lp-release-<hash>--agent-agent-a-<hash>`.
Task identity priority is `--task-id`, `CHATGPT_TASK_ID`, `CODEX_TASK_ID`,
`AGENT_TASK_ID`, `CODEX_THREAD_ID`, `CODEX_SESSION_ID`, `CODEX_GOAL_ID`, then
the prompt/task title hash. Thread/session ids are narrower than goal ids so
child agents under the same parent goal do not share a room by accident. Agent identity is still
recorded for audit via
`--agent-id`, `CHATGPT_AGENT_ID`, `CODEX_AGENT_ID`, or `AGENT_ID`. The room
registry records the requested alias, effective alias, task id, agent id, task
title, and concise room label. Use `--shared-room` only when multiple tasks or
agents should deliberately use the exact same ChatGPT conversation.
If an upgrade changes the effective alias format, the runner migrates an older
task-scoped room only when `requestedAlias + task.id + agent.id` uniquely match;
multiple matches fail closed.
`--fresh` is one-off by design: even if a fresh prompt is sent and later times
out, it records only `freshThreads` recovery metadata and must not move the
alias.

Generated `repo-context.md` is secret-scanned and requires
`--confirm-repo-context-upload` or
`CHATGPT_CONFIRM_REPO_CONTEXT_UPLOAD=1` before it can be uploaded or inlined.
Use `--repo-context=off` / `--no-repo-context` or pass explicit scrubbed
`--upload-file` artifacts for narrower calls.

If no ChatGPT Project URL is configured, first-time alias calls must explicitly
use `--new` / `--new-thread` to bind a fresh ChatGPT room. Project-scoped calls
open a new bound conversation by default; non-Project calls do not.

Upload dedupe is local and automatic. The CLI records successful uploads in
`.devspace/state/chatgpt-upload-ledger.json`. Ordinary message attachments are
scoped by the actual ChatGPT conversation URL, not just the Project URL, so a
new conversation still receives its own attachments. Project source uploads are
scoped by Project URL. If the same file content was already uploaded in that
scope, the next call skips the upload instead of triggering ChatGPT's
duplicate-file modal. If the file content changes, the staged upload filename
includes the new content hash, so ChatGPT sees a new version. Agents should not
solve duplicate modals by retrying, reloading, or interrupting a running answer.
At call start, after confirming ChatGPT is not actively generating, the wrapper
also dismisses stale duplicate-upload modals and removes stale composer
attachments left by older failed runs. During and after file upload, it checks
again for the duplicate-upload modal and dismisses it so the modal cannot cover
the composer or send button.
If an agent sees the duplicate-upload modal outside a normal call, run
`chatgpt-pro cleanup duplicate-upload`. It scans visible ChatGPT tabs and clicks
only the duplicate modal OK button; if ChatGPT is still thinking, it does not
reload, stop, resend, or clear attachments.

Project source/knowledge upload is separate from ordinary message attachment:

```bash
chatgpt-pro project-source upload \
  --source-file=.devspace/context/current/repo-context.md \
  --confirm-project-source-upload
```

Creating a new ChatGPT Project is intentionally fail-closed until the live UI
flow is stable; create the Project once, then pass its URL. The uploader must
not fall back to the ordinary ChatGPT message composer file input; if it cannot
find a safe Project source input, it fails closed.

## How it works

```text
Codex agent
   │  chatgpt-pro call --alias=main --prompt="…"
   ▼
chatgpt-pro CLI ──acquire──►  global browser lock        (one agent at a time)
   │
   ▼
dedicated Chrome profile ──CDP──►  chatgpt.com           (you are logged in)
   │  • attach repo-context.md            │  Pro thinks + answers
   │  • type prompt (Input.insertText)    ▼
   └────────────────────────►  read the newest assistant turn (anchored)
                                          │
                                          ▼
                  .devspace/runs/<id>/   receipt.json · transcript.md · final.png
```

The canonical message path is text-only: DOM focus for the composer, CDP
`Input.insertText` for the text, and a DOM button click to send. No OS-level
mouse/keyboard automation, no voice or dictation.

## Safety posture

- **You own the login.** Automation never types a password, OTP, or solves a
  CAPTCHA, and never reads cookies or session storage. If login is needed, it
  stops and asks you.
- **Text-only, no OS automation.** No synthetic OS mouse/keyboard, no voice. A
  `test:non-interference` gate enforces the boundary.
- **One profile, one lock.** A global browser-profile lock means concurrent
  agents serialize cleanly instead of fighting over the window.
- **Fails closed.** Ambiguous provenance produces a stable error code
  (`auth.login_required`, `lock.busy`, `response.possibly_stale`, …) — never a
  guessed answer.
- **On the record.** The verbatim prompt and response, hashes, a screenshot, and
  network/console logs land in `.devspace/runs/<id>/` for every call.

## Thread echo

Interactive Codex use keeps the exchange in the Codex session log. `call` prints
this block by default — paste it verbatim, don't summarize:

```md
## Message Sent To ChatGPT Pro

...

## Message Received From ChatGPT Pro

...
```

If the prompt was definitely not sent, the first heading is
`Message Not Sent To ChatGPT Pro`. If a send click/submission completed but the
user-message anchor could not be verified, the first heading is
`Message Send Status Unknown`; do not automatically resend in that state.

## Command surface

The installed plugin exposes the `chatgpt-pro-line` skill and the `chatgpt-pro`
CLI. Inside this source repo the same behavior is available via `npm run`:

| Command | What it does |
| --- | --- |
| `npm run chrome` / `chrome:headless` / `chrome:debug` | Launch the dedicated ChatGPT browser (visible / headless / verbose) |
| `npm run cdp:smoke` | Verify `/json/version` and `/json/list` |
| `npm run levels:list` / `levels:set -- --level=Pro` | Read or select the live intelligence level |
| `npm run choices:set -- --model=5.4` | Select the live model |
| `npm run rooms:list` | List repo-owned rooms (no CDP) |
| `npm run context:bundle -- --name=focused` | Build the repo-context monofile |
| `npm run chatgpt:call -- --alias=main --message-file=prompt.md` | Source-repo alias for `chatgpt-pro call` |
| `./bin/chatgpt-pro cleanup duplicate-upload` | Dismiss ChatGPT duplicate-upload modals safely |
| `./bin/chatgpt-pro project-source upload --project-url=... --source-file=... --confirm-project-source-upload` | Upload explicit files to ChatGPT Project source/knowledge |
| `npm run history:export -- --alias=spec --last=20` | Export visible history |
| `npm run plugin:sync` | Refresh the materialized install bundle |

Common runtime switches: `BROWSER_POSTURE=headed|headless`,
`CHATGPT_DEFAULT_LEVEL` (default `Pro Extended,Pro`),
`CHATGPT_COMPLETION_MARKER` (default `输出完毕`),
`CHATGPT_REQUIRE_COMPLETION_MARKER=0` only for transport debugging,
`CHATGPT_PROJECT_URL`, `CHATGPT_AGENT_ID`, `CHATGPT_SHARED_ROOM=1`,
`CHATGPT_TASK_TITLE`, `CHATGPT_RESPONSE_TIMEOUT_MS` (default `900000`),
`CHATGPT_REPO_CONTEXT_MODE=auto|upload|inline|off`,
`CHATGPT_CONFIRM_REPO_CONTEXT_UPLOAD=1`, `CHATGPT_LOCK_TIMEOUT_MS`
(default `600000`), `BROWSER_OBSERVER=1` (print a run-inspector URL). See the
contract docs for the full list.

## Tests

```bash
npm run test:v1     # deterministic package gate (no browser, no login)
npm run test:live   # live browser proof suite (needs a logged-in ChatGPT)
```

- `npm test`: runs deterministic tests only — it does not require Chrome or a
  logged-in ChatGPT website session.
- `npm run test:v1` adds the v1 readiness gate on top of the deterministic
  suite.
- `npm run test:plugin-install` proves the materialized plugin installs into a
  fresh Codex home from the local marketplace entry.
- `npm run test:live` drives the real website: doctor, history export, room
  rebind/repair, and the repo/thread isolation matrix.
- Live proof scripts are `live:doctor`, `live:history-export`,
  `live:rooms-rebind`, `live:rooms-repair`, and `live:repo-thread-matrix`.

## Reference

- [docs/chatgpt-call-contract.md](docs/chatgpt-call-contract.md) — the full call
  contract: rooms, context tiers, concurrency, receipts, and the complete
  failure-code list.
- [docs/subagent-browser-contract.md](docs/subagent-browser-contract.md) — the
  lower-level browser, login-boundary, and CDP details.

## Repo layout

- `bin/chatgpt-pro`, `src/`, `scripts/` — the CLI, runtime, and self-tests.
- `skills/`, `.codex-plugin/`, `.agents/plugins/marketplace.json` — the Codex
  plugin surface.
- `plugins/codex-chatgpt-pro-plugin/` — the materialized install bundle, kept in
  sync from the root by `npm run plugin:sync` (don't edit it by hand).

## License

MIT © Haptica.
