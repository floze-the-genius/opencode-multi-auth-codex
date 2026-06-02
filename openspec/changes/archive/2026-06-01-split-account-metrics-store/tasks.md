# Tasks: Split Account Metrics Store

## Phase 1: Foundation
- [x] 1.1 Add failing unit coverage for the new sidecar metrics store — `tests/unit/metrics-store.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/metrics-store.test.ts`
  - Expected: the new metrics-store tests fail on the current codebase, proving the missing sidecar/cache/flush/history contract.

- [x] 1.2 Add failing cold-start coverage for `getNextAccount()` without `startWebConsole()`, asserting the plugin/runtime path reads startup-loaded `usageCount`/`lastUsed` from the migrated cache and still picks the least-used account correctly on a cold start — `tests/unit/rotation-strategy.test.ts`, `tests/unit/index-sticky.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/rotation-strategy.test.ts tests/unit/index-sticky.test.ts`
  - Expected: the cold-start allocator assertions fail before metrics are guaranteed to load on every entry path.

- [x] 1.3 Implement `src/metrics-store.ts` with `MetricsData`, the authoritative in-memory cache, a lazy `ensureLoaded()` guard for every accessor so any entry path triggers load before the first read (`getNextAccount()`, `evaluateAccountHealth()`, and candidate sorting), `account-metrics.json` path resolution, load/save/flush APIs, and moved `buildHistoryEntry`/`appendHistory` logic; choose and encode the debounce + periodic flush cadence here — `src/metrics-store.ts`, `src/rotation.ts`, `src/index.ts`, `src/web.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/metrics-store.test.ts tests/unit/rotation-strategy.test.ts tests/unit/index-sticky.test.ts`
  - Expected: metrics-store tests pass and cold-start allocator reads come from the loaded cache instead of zeroed telemetry.

## Phase 2: Migration v2 -> v3
- [x] 2.1 Add failing migration tests that seed v2 `accounts.json` with inline metrics and cover both partial-completion states: (a) `account-metrics.json` already exists while `accounts.json` is still v2, and (b) `accounts.json` is already v3 but the sidecar is missing or failed; assert reruns converge without double-counting or data loss — `tests/unit/store.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/store.test.ts`
  - Expected: the new migration assertions fail before the store migration handles idempotent recovery.

- [x] 2.2 Implement `migrateV2toV3` and bump the store version to 3, writing `account-metrics.json` successfully first, then stripping metrics from `accounts.json` and only then bumping the version; preserve validation rules and account for `saveStore()` recovery cues (`.bak`/`.lkg`) when partial writes need to be retried — `src/store.ts`, `src/metrics-store.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/store.test.ts`
  - Expected: v2 stores migrate to v3, inline metric fields disappear from `accounts.json`, migrated metrics land in `account-metrics.json`, and reruns converge cleanly.

## Phase 3: Allocator reads from in-memory metrics
- [x] 3.1 Add failing rotation tests for least-used ordering, zero-usage boost, recent limit-error scoring, and the cold-start plugin path that calls `getNextAccount()` without `startWebConsole()`, asserting the allocator/sticky path has no cache-read / `accounts.json`-write skew window once the combined fix lands — `tests/unit/rotation-strategy.test.ts`, `tests/unit/index-sticky.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/rotation-strategy.test.ts tests/unit/index-sticky.test.ts`
  - Expected: the allocator-cache assertions fail before the combined read/write redirection is switched over.

- [x] 3.2 Make `src/rotation.ts` read `usageCount`, `lastUsed`, and `lastLimitErrorAt` from the startup-loaded metrics cache in every decision path (`getNextAccount()`, `evaluateAccountHealth()`, and candidate sorting) and, in the same cohesive change, redirect the allocator `updateAccount()` usage-write path plus the sticky direct-mutation `saveStore()` path through the metrics cache so `getNextAccount()` never observes cache reads with `accounts.json` writes in between — `src/rotation.ts`, `src/metrics-store.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/rotation-strategy.test.ts`
  - Expected: rotation chooses the same aliases as before, and both the read path and allocator/sticky writes use the cache with no intermediate `accounts.json` telemetry window.

## Phase 4: Write-path redirection
- [x] 4.1 Add failing tests that prove telemetry-only updates stop rewriting `accounts.json`, deletions remove the matching metrics entry, and weighted-rotation presets still compute from merged metrics/cache-backed rate limits — `tests/unit/store.test.ts`, `tests/unit/limits-refresh.test.ts`, `tests/unit/refresh-queue.test.ts`, `tests/unit/codex-auth-sync.test.ts`, `tests/unit/settings.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/store.test.ts tests/unit/limits-refresh.test.ts tests/unit/refresh-queue.test.ts tests/unit/codex-auth-sync.test.ts tests/unit/settings.test.ts`
  - Expected: the split-write and weighted-preset assertions fail before the remaining non-allocator metrics are redirected out of `accounts.json`.

- [x] 4.2 Split the remaining mixed state/metrics writes across the affected non-allocator call sites and route metric fields through the cache while keeping `accounts.json` state-only; allocator/sticky telemetry redirection is already handled in 3.2 — `src/store.ts`, `src/index.ts`, `src/limits-refresh.ts`, `src/auth.ts`, `src/codex-auth.ts`, `src/refresh-queue.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/store.test.ts tests/unit/limits-refresh.test.ts tests/unit/refresh-queue.test.ts tests/unit/codex-auth-sync.test.ts`
  - Expected: the remaining non-allocator telemetry-only updates land in `account-metrics.json`, while pure state mutations still persist correctly in `accounts.json`.

- [x] 4.3 Verify and, if needed, adjust `src/settings.ts` weighted-rotation preset computation so it consumes merged metrics / cache-backed rate limits rather than inline `account.rateLimits` — `src/settings.ts`, `tests/unit/settings.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/settings.test.ts`
  - Expected: weighted preset selection continues to work with merged metrics and does not depend on metric fields remaining inline in `accounts.json`.

## Phase 5: Backend merge contract
- [x] 5.1 Add failing contract/fixture tests that seed both files and assert `/api/state` and `/api/accounts` keep the same merged shape — `tests/integration/dashboard-api-contract.test.ts`, `tests/web-headless/dashboard-parity-accounts.test.ts`, `tests/web-headless/dashboard-parity-overview.test.ts`, `tests/web-headless/dashboard-parity-operations.test.ts`
  **Verification**:
  - Run: `pnpm run test:integration:dashboard-contract`
  - Run: `pnpm run test:web:headless -- tests/web-headless/dashboard-parity-accounts.test.ts tests/web-headless/dashboard-parity-overview.test.ts tests/web-headless/dashboard-parity-operations.test.ts`
  - Expected: the new merged-shape assertions fail until the API reads the sidecar metrics.

- [x] 5.2 Implement `loadStoreWithMetrics()` (or equivalent) and merge helpers, route `/api/state`, `/api/accounts`, and `recommendAlias()` through merged accounts, and update shared seed helpers to write both files — `src/web.ts`, `tests/integration/dashboard-api-contract.test.ts`, `tests/web-headless/dashboard-parity-accounts.test.ts`, `tests/web-headless/dashboard-parity-overview.test.ts`, `tests/web-headless/dashboard-parity-operations.test.ts`, `tests/web-headless/dashboard-sticky-session-admin.test.ts`, `tests/web-headless/dashboard-parity-configuration.test.ts`
  **Verification**:
  - Run: `pnpm run test:integration:dashboard-contract`
  - Run: `pnpm run test:web:headless -- tests/web-headless/dashboard-parity-accounts.test.ts tests/web-headless/dashboard-parity-overview.test.ts tests/web-headless/dashboard-parity-operations.test.ts tests/web-headless/dashboard-sticky-session-admin.test.ts tests/web-headless/dashboard-parity-configuration.test.ts`
  - Expected: merged API payloads keep the existing shape, and the seed helpers no longer rely on inline metrics inside `accounts.json`.

## Phase 6: Shutdown/flush wiring
- [x] 6.1 Add failing tests for shutdown hook registration and flush invocation from the web console startup path and plugin entry — `tests/unit/metrics-store.test.ts`, `tests/unit/index-config.test.ts`, `tests/integration/web-server.test.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/metrics-store.test.ts tests/unit/index-config.test.ts`
  - Run: `pnpm run test:integration -- tests/integration/web-server.test.ts`
  - Expected: the hook/flush assertions fail before the shutdown wiring exists.

- [x] 6.2 Register async best-effort flush on `beforeExit`, `SIGINT`, and `SIGTERM`, plus sync flush on `exit`, from `startWebConsole()` and the plugin entry in `src/index.ts` — `src/web.ts`, `src/index.ts`, `src/metrics-store.ts`
  **Verification**:
  - Run: `pnpm run test:unit -- tests/unit/metrics-store.test.ts tests/unit/index-config.test.ts`
  - Run: `pnpm run test:integration -- tests/integration/web-server.test.ts`
  - Expected: shutdown hooks fire once and pending metrics are flushed on the supported process-exit paths.

## Phase 7: Python helper
- [x] 7.1 Add a runnable Python regression test (`tests/python/test_auto_login_no_metrics.py`) that exercises the helper against a temp HOME/config fixture, saves `accounts.json`, and asserts `lastRefresh`, `lastSeenAt`, `usageCount`, and `rateLimitHistory` are absent from every account object — `auto-login/auto_login.py`, `tests/python/test_auto_login_no_metrics.py`
  **Verification**:
  - Run: `python -m pytest tests/python/test_auto_login_no_metrics.py`
  - Expected: the regression test fails on the current codebase until the helper stops writing `lastRefresh`, `lastSeenAt`, `usageCount`, and `rateLimitHistory` back into `accounts.json`.

- [x] 7.2 Remove the metric/history writes from `add_account_to_store()` and the overwrite path so the Python helper persists account state only — `auto-login/auto_login.py`
  **Verification**:
  - Run: `python -m py_compile auto-login/auto_login.py`
  - Run: `python -m pytest tests/python/test_auto_login_no_metrics.py`
  - Expected: the helper stays syntactically valid and the regression test confirms `lastRefresh`, `lastSeenAt`, `usageCount`, and `rateLimitHistory` are absent from generated `accounts.json` data.

## Phase 8: Final verification
- [x] 8.1 Run the full backend/frontend verification sweep and confirm the dashboard contract, headless parity, and web tests stay green — all affected modules
  **Verification**:
  - Run: `pnpm run build:backend`
  - Run: `pnpm run test:unit`
  - Run: `pnpm run test:integration`
  - Run: `python -m pytest tests/python/test_auto_login_no_metrics.py`
  - Run: `pnpm run test:web:headless`
  - Run: `pnpm --dir web test`
  - Run: `pnpm run test:integration:dashboard-contract`
  - Expected: backend builds cleanly, targeted regressions stay green, the Python regression confirms the forbidden metric/history keys are absent, and the web charts/overview suites remain unchanged.
