# Codex CLI Live Testing TODO

This checklist is for live validation with your OpenCode + Codex workflow after backing up your current `guard22` config.

Use this file as your step-by-step TODO. Check each box as you complete it.

## 1) Preflight (Do first)

- [ ] Backup current config and plugin state (`~/.config/opencode`, `~/.codex`, current plugin refs).
- [ ] Confirm this repo is built from latest local source:

```bash
bun run lint
bun run build
```

- [ ] Run the full automated validation once before manual/live testing:

```bash
bun run test:unit
bun run test:integration
bun run test:web:headless
bun run test:failure
bun run test:stress
bun run test:sandbox
bun run test:soak:48h
```

## 2) Start Dashboard + Basic Health

- [ ] Start dashboard on loopback:

```bash
bun dist/cli.js web --host 127.0.0.1 --port 3434
```

- [ ] Open `http://127.0.0.1:3434` and confirm UI renders (no blank page, no JS syntax errors).
- [ ] Verify state endpoint responds:

```bash
curl -s http://127.0.0.1:3434/api/state
```

- [ ] Verify non-loopback bind is blocked:

```bash
bun dist/cli.js web --host 0.0.0.0 --port 3434
```

Expected: fails with `LOCALHOST_ONLY`.

## 3) API Safety/Crash-Proof Checks

- [ ] Malformed JSON returns 400 and server stays alive:

```bash
curl -i -X POST http://127.0.0.1:3434/api/switch -H 'Content-Type: application/json' --data '{bad json'
curl -i -X POST http://127.0.0.1:3434/api/switch -H 'Content-Type: application/json' --data '{}'
```

Expected: first is `400` (`INVALID_JSON`), second returns normal API error but process is still up.

## 4) Account Lifecycle (Core)

- [ ] Add at least 2 test accounts:

```bash
bun dist/cli.js add test1
bun dist/cli.js add test2
```

- [ ] Confirm accounts present:

```bash
bun dist/cli.js status
curl -s http://127.0.0.1:3434/api/accounts
```

- [ ] Disable one account from UI and confirm it shows disabled.
- [ ] Re-enable the same account and confirm immediate recovery.
- [ ] Try disabling the last enabled account and verify API/UI blocks with 409.
- [ ] Verify unknown alias toggle returns deterministic error:

```bash
curl -i -X PUT http://127.0.0.1:3434/api/accounts/does-not-exist/enabled -H 'Content-Type: application/json' --data '{"enabled":false}'
```

Expected: `404` with `ACCOUNT_NOT_FOUND`.

- [ ] Re-auth enabled account from UI and confirm OAuth flow starts.
- [ ] Re-auth disabled account and verify blocked (409 `ACCOUNT_DISABLED`).

## 5) Force Mode

- [ ] Enable force mode for one alias in UI.
- [ ] Verify force state endpoint:

```bash
curl -s http://127.0.0.1:3434/api/force
```

- [ ] Toggle force for same alias twice and verify TTL does not extend unexpectedly.
- [ ] Disable forced alias and verify force auto-clears.
- [ ] Clear force manually and verify previous strategy is restored.

## 6) Settings + Weighted Rotation

- [ ] Get settings:

```bash
curl -s http://127.0.0.1:3434/api/settings
```

- [ ] Set weighted strategy + weights:

```bash
curl -i -X PUT http://127.0.0.1:3434/api/settings -H 'Content-Type: application/json' --data '{"rotationStrategy":"weighted-round-robin","criticalThreshold":10,"lowThreshold":30,"accountWeights":{"test1":0.7,"test2":0.3}}'
```

- [ ] Confirm settings persisted across restart of dashboard.
- [ ] Apply preset and verify response:

```bash
curl -i -X POST http://127.0.0.1:3434/api/settings/preset -H 'Content-Type: application/json' --data '{"preset":"balanced"}'
```

## 7) Limits Refresh + Confidence

- [ ] Trigger refresh all:

```bash
curl -i -X POST http://127.0.0.1:3434/api/limits/refresh -H 'Content-Type: application/json' --data '{}'
```

- [ ] Verify queue/state updates in UI (`queued` -> `running` -> `success/error`).
- [ ] Verify accounts show confidence badge states (`fresh/stale/error/unknown`).
- [ ] Confirm no-data accounts show `unknown` (not fake `0%`).

## 8) Feature Flag / Antigravity Gate

- [ ] With Antigravity disabled, verify endpoint blocked:

```bash
curl -i -X POST http://127.0.0.1:3434/api/antigravity/refresh -H 'Content-Type: application/json' --data '{}'
```

Expected: `403 FEATURE_DISABLED`.

- [ ] Enable feature flag via settings API only if you want to test Antigravity paths.

## 9) OpenCode + Codex Live Flow

- [ ] Run OpenCode with this plugin config.
- [ ] Send at least 20 real requests through OpenCode using mixed prompts/models.
- [ ] Verify no request-loop failures and no process crashes.
- [ ] Confirm active alias rotates when expected and respects enabled/disabled/force rules.
- [ ] Monitor logs for deterministic, redacted errors:

```bash
tail -f ~/.config/opencode-multi-auth/logs/codex-soft.log
```

## 10) Fast Regression Loop (when something fails)

- [ ] Capture failing command/API call.
- [ ] Capture exact response code + body.
- [ ] Capture relevant log lines.
- [ ] Reproduce with smallest possible case.
- [ ] Fix in `src/*`, rebuild, rerun only impacted suites first, then full runbook.

## 11) Final Exit Criteria

- [ ] Dashboard stable, no parse/runtime crashes.
- [ ] localhost-only bind enforced.
- [ ] Account lifecycle works (enable/disable/reauth) with deterministic errors.
- [ ] Force mode lifecycle works and clears correctly.
- [ ] Settings persist and are used by live rotation.
- [ ] Limits refresh works and confidence states are correct.
- [ ] All automated scripts pass.

## Issue Log Template

Use this format while testing live:

```text
Issue ID:
When:
Command / API:
Expected:
Actual:
HTTP/code:
Logs:
Repro steps:
Fix commit/path:
Retest result:
```
