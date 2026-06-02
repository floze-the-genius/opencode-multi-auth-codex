# Verification Report: Split Account Metrics Store

**Change:** `split-account-metrics-store`
**Verdict:** **COMPLIANT-WITH-NOTES**

## Completeness

All 8 task phases are marked complete in `tasks.md` and the implementation covers the accelerated proposal success criteria. Static verification found the intended split between durable account state and telemetry sidecar, with residual follow-up risks noted below.

## Build and Test Evidence

Orchestrator-run verification sweep:
- `pnpm run build:backend`: clean (tsc).
- `pnpm run test:unit`: 23 suites, 204 passed, 2 skipped.
- `pnpm run test:integration`: 4 suites, 20 passed.
- `pnpm run test:integration:dashboard-contract`: 3 passed.
- `pnpm run test:web:headless`: 12 suites, 66 passed.
- `pnpm --dir web test`: 177 + 10 passed.
- `python tests/python/test_auto_login_no_metrics.py`: ok (exit 0). Note: pytest not installed in env; test is runnable as a plain script.

## Compliance Matrix

| Criterion | Status | Evidence |
|---|---:|---|
| A. `accounts.json` mutated only for STATE changes | PASS | Metric field set centralized in `src/store.ts:42-55`; `saveStore()` strips metrics before writing at `src/store.ts:630-632`; `updateAccount()` routes metric fields to `setMetrics()` at `src/store.ts:785-798`; telemetry-only regression asserts no account-file rewrite at `tests/unit/store.test.ts:493-515`. Residual metric-carrying `updateAccount()` calls (web reauth `src/web.ts:1600-1602`, probe token sync `src/probe-limits.ts:148-165`) route through the splitter rather than writing metrics to `accounts.json`. |
| B. `/api/state` and `/api/accounts` shape unchanged | PASS | Merged loader applies sidecar metrics at `src/store.ts:705-722`; `scrubAccount()` removes credentials only at `src/web.ts:224-226`; `/api/state` uses `loadStoreWithMetrics()` and passes merged accounts to `recommendAlias()` at `src/web.ts:1190-1221`; `/api/accounts` returns merged metric fields at `src/web.ts:1467-1487`. Contract assertions at `tests/integration/dashboard-api-contract.test.ts:153-177,192-225`. New-account defaults preserved (`src/store.ts:189,711`). |
| C. Allocator correctness/cache authority | PASS | Metric access via lazy-loaded cache `getMetrics()`/`ensureLoaded()` at `src/metrics-store.ts:179-195,330-333`; allocator health/sorting reads cached `usageCount`/`lastUsed`/`lastLimitErrorAt` at `src/rotation.ts:79-104,169-199,412-429`; allocator/sticky writes use `setMetrics()` + stripped state saves at `src/rotation.ts:107-129,289-294,362-368,529-539`. Tests at `tests/unit/rotation-strategy.test.ts:217-312`. |
| D. Migration crash-safety/idempotency | PASS | Version bumped to 3 at `src/store.ts:40`; migration writes sidecar first at `src/store.ts:350-368`, then strips/saves v3 at `src/store.ts:370-383`; defers stripping if sidecar write fails at `src/store.ts:386-395`; `.bak`/`.lkg` recovery at `src/store.ts:380,446-470,634-702`. Tests at `tests/unit/store.test.ts:277-445`. |
| E. Flush durability | PASS | Sidecar path/debounce/periodic cadence at `src/metrics-store.ts:14-20`; flush scheduling avoids hot-path writes at `src/metrics-store.ts:264-286`; async/sync flush APIs at `src/metrics-store.ts:445-456`; idempotent shutdown hooks (beforeExit/SIGINT/SIGTERM/exit) at `src/metrics-store.ts:458-510`; registered from plugin and web startup at `src/index.ts:251-253`, `src/web.ts:1171-1181`. Tests at `tests/unit/metrics-store.test.ts:153-169`, `tests/unit/index-config.test.ts:59-70`. |
| F. Python helper forbidden keys removed | PASS | Metric keys defined only for stripping at `auto-login/auto_login.py:52-65`; overwrite path strips old metrics at `auto-login/auto_login.py:278-288`; new-account payload state-only at `auto-login/auto_login.py:265-276`. Regression at `tests/python/test_auto_login_no_metrics.py:10,53-57,59-105`. |
| G. Non-goals respected | PASS | No new web metrics endpoint; web only imports flush hook at `src/web.ts:27`. `saveStore()` keeps existing atomic rewrite, no cross-process lock at `src/store.ts:610-702`. 5-minute token refresh threshold unchanged at `src/auth.ts:371-374`. Sticky sidecar handling separate at `src/rotation.ts:239-244,367-368`; no changes to `src/sticky-sessions.ts` or antigravity files. |

## Issues Found

No blocking non-compliance found.

## Residual Risks / Follow-ups

1. **Collapsed public account type still includes state + metrics.** `AccountCredentials` still declares metric fields at `src/types.ts:13-17,37-44`; compatible but keeps future write-site mistakes easier. Consider a follow-up type split.
2. **Inline `account.rateLimits` fallback remains in some readers.** Weighted presets prefer cache but fall back to inline at `src/settings.ts:370,391`; request/refresh merge paths also read `account.rateLimits` at `src/index.ts:778-782`, `src/limits-refresh.ts:27-35,128-136`. Could mask missing merge coverage or drop prior sidecar windows on partial updates.
3. **v3 + missing sidecar recovery keeps empty metrics if state-only.** Preserves account state (`tests/unit/store.test.ts:405-445`) but cannot recover telemetry absent from sidecar; acceptable per telemetry-loss risk, worth documenting operationally.

## Verdict

**COMPLIANT-WITH-NOTES** — acceptance criteria A-G satisfied by code and tests, with non-blocking follow-ups around type separation and remaining inline metric fallbacks.
