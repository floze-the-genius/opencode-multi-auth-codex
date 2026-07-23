# Post-Implementation Test Execution Plan

This runbook defines exactly how to validate the implementation after coding is complete.

## 1) Goal
- Prove correctness, safety, and reliability of multi-auth core behavior before main usage.
- Catch regressions in rotation, account lifecycle controls, force mode, and limits reporting.
- Ensure the weekly-limit inconsistency class is permanently prevented.

## 2) Required Test Surfaces
- `Unit`: deterministic logic (rotation/store/limits parsing/force rules).
- `Integration`: API behavior and state transitions.
- `Headless UI E2E`: dashboard behavior without manual browser usage.
- `Failure injection`: forced 401/403/429/402/400 + probe failures.
- `Reliability`: stress + crash recovery + soak.

## 3) Required Scripts (must exist by implementation complete)
- `bun run lint`
- `bun run build`
- `bun run test:unit`
- `bun run test:integration`
- `bun run test:web:headless`
- `bun run test:failure`
- `bun run test:stress`
- `bun run test:sandbox`
- `bun run test:soak:48h`

If a script is missing, add it as part of implementation before declaring test-complete.

## 4) Execution Order (No Skips)
1. Static + build gates.
2. Unit suites.
3. Integration suites.
4. Headless UI suites.
5. Failure injection suites.
6. Stress and concurrency suites.
7. Crash-recovery suites.
8. 48h soak.

If any stage fails, fix and restart from the failed stage; if fix touches shared core paths (`rotation`, `store`, `web`, `limits`), rerun from stage 1.

## 5) Detailed Coverage Checklist

## 5.1 Account Enabled Switch (new disable mechanism)
- API: `PUT /api/accounts/:alias/enabled` toggles state with deterministic errors.
- Rotation: disabled accounts are never selected.
- Persistence: enabled/disabled state survives restart.
- UI headless:
  - iOS-style switch renders per account.
  - switch states: `off`, `on`, `updating`, `error`.
  - in-flight toggles are non-reentrant (double click safe).
- Legacy control removal:
  - old disable button/control is absent.
  - only source of disablement is the `Enabled` switch.

## 5.2 Force Mode (separate from account enable)
- Force toggle remains separate from account `Enabled` switches.
- Enable force pins forced alias while eligible.
- Clear force restores prior strategy.
- Disable forced alias auto-clears force and restores prior strategy.
- TTL behavior: 24h anchor does not extend on repeated force toggles.

## 5.3 Re-auth per Account
- `POST /api/accounts/:alias/reauth` updates only target alias credentials.
- Active-alias re-auth keeps active auth pointer consistent.
- UI headless verifies `idle -> in-progress -> success/error` transitions.

## 5.4 Limits Accuracy (permanent fix requirements)
- Probe compatibility:
  - global `xhigh` config does not break limits probe.
  - fallback works on `unsupported_value` / `reasoning.effort` errors.
- Failed-probe-safe behavior:
  - failed/incomplete probes never overwrite stored `rateLimits`.
  - `limitStatus=error`, `lastLimitErrorAt` updated, prior values preserved.
- No-data behavior:
  - accounts with no successful snapshot report `unknown` (not `0%`).
- Freshness behavior:
  - API/UI provides confidence state (`fresh`, `stale`, `error`, `unknown`).

## 5.5 Crash Safety + Recovery
- Interrupt process during store write and restart.
- Verify store can be loaded or auto-restored from last-known-good snapshot.
- Verify no partial JSON corruption causes undefined runtime behavior.

## 5.6 Security and Exposure
- Dashboard rejects non-loopback host binding.
- Mutating actions reject unknown aliases and disabled aliases with deterministic errors.
- Log redaction covers tokens/credentials.

## 6) Headless UI Test Cases (minimum)
- Accounts table renders all aliases.
- Account `Enabled` switch toggles and persists across reload.
- Force switch works independently of account `Enabled` switch.
- Re-auth action starts and resolves with correct status state.
- Limits badge/text reflects `fresh/stale/error/unknown` correctly.
- Legacy disable control is not present.

## 7) Reliability and Flake Control
- Repeat `test:integration` and `test:web:headless` 5 consecutive runs; all must pass.
- Stress test must show no lost updates, deadlocks, or corrupted store state.
- Soak gate (48h): no crashes, no stuck rotation, no corruption, at least one force lifecycle.

## 8) Command Runbook
```bash
bun install --frozen-lockfile
bun run lint
bun run build

bun run test:unit
bun run test:integration
bun run test:web:headless
bun run test:failure
bun run test:stress
bun run test:sandbox
bun run test:soak:48h
```

## 9) Pass/Fail Criteria
- All commands exit zero.
- All required feature checklists in section 5 are validated.
- No blocker/high severity defects open.
- SLO gates from `IMPLEMENTATION_PLAN.md` are met.

## 10) Evidence and Artifacts
- Store results in `docs/QA.md`:
  - command, timestamp, pass/fail
  - failing output (if any) and remediation
  - links/paths to logs, traces, and headless test reports
- Keep artifacts for the canary + 72h watch window.
