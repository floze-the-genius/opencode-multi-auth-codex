# Proposal: Split Account Metrics Store

## Intent

Stop high-frequency history and telemetry updates from rewriting the credential store at `~/.config/opencode-multi-auth/accounts.json`. Today `saveStore()` rewrites the whole account file through a read-modify-write snapshot and atomic rename without a cross-process lock, and request-time telemetry such as rate-limit history can trigger writes on every API request. That risks last-writer-wins races and lost credential updates. The change will keep `accounts.json` focused on durable account state while moving history and telemetry into a sidecar `account-metrics.json` file.

This accelerated-SDD proposal is the acceptance reference for implementation and verification; no separate formal spec or design artifact will be produced for this change.

## Scope

### In Scope

- Create a separate account metrics store file at `path.join(path.dirname(getStorePath()), 'account-metrics.json')`, matching the sidecar path convention used by `sticky-sessions.ts`.
- Treat allocator telemetry (`usageCount`, `lastUsed`, `lastLimitErrorAt`) as authoritative in memory during process lifetime, with startup load from `account-metrics.json` and debounced/periodic flushes instead of per-request credential-store writes.
- Add shutdown flushing for metrics: synchronous flush on `exit`, and async/best-effort flush on `beforeExit`, `SIGINT`, and `SIGTERM`, registered from the web console startup path and/or plugin entry path.
- Preserve `/api/state` and `/api/accounts` response shapes by merging account state from `accounts.json` with metrics from `account-metrics.json` before serving API payloads.
- Add automatic one-time migration from store version 2 to 3: extract metric fields from existing account objects into `account-metrics.json`, strip those fields from accounts, and bump `CURRENT_STORE_VERSION` from 2 to 3.
- Move rate-limit history derivation (`buildHistoryEntry` / `appendHistory`, cap 160 and dedup behavior) into the metrics update path.
- Update TypeScript call sites that currently write mixed state and metrics so state fields are persisted through `updateAccount()`/`saveStore()` and metrics fields are persisted through the new metrics cache/store API.
- Update `auto-login/auto_login.py` so it no longer writes history or telemetry keys into `accounts.json`; the Python helper should continue to write credentials/account state only and should not write `account-metrics.json`.
- Update tests and seed helpers so API contract tests seed both account state and metrics when they assert dashboard state or account metrics.

### Deferred / Needs Discovery

- Exact flush interval/debounce duration should be selected during implementation to balance durability and write reduction; acceptance requires that request paths do not synchronously flush metrics to disk.
- Exact helper names are flexible, but implementation should provide a clear merged load helper such as `loadStoreWithMetrics()` or equivalent, plus metrics update helpers that keep allocator-facing merged accounts current in memory.
- Exact registration point for shutdown hooks may be split between `startWebConsole()` and the plugin entry in `src/index.ts`; implementation must ensure the main runtime paths that mutate metrics register hooks once.

### Out of Scope

- No cross-process file lock and no rewrite of `saveStore()`'s read-modify-write model.
- No change to `/api/state` or `/api/accounts` response shape, no frontend contract change, and no new dashboard endpoint required.
- No changes to `sticky-sessions.json` or `antigravity-accounts.json`.
- No semantic change to the 5-minute proactive token refresh threshold.
- No semantic change to rotation or allocator selection logic beyond reading/writing telemetry from the in-memory metrics cache instead of `accounts.json`.

## Approach

### Behavior Changes

| Change | From | To | Reason | Impact |
| --- | --- | --- | --- | --- |
| Credential store contents | Account objects include credentials, durable state, and telemetry/history. | Account objects contain durable account state only. | Reduce high-frequency writes to credentials. | `accounts.json` changes only for account state mutations. |
| Metrics persistence | `updateAccount()`/`addAccount()` derive and persist rate-limit history inside `accounts.json`. | Metrics helpers derive and persist history in `account-metrics.json`. | Separate telemetry write path from credential write path. | Existing charts/predictions remain available through API merge. |
| Allocator telemetry | `usageCount`, `lastUsed`, and `lastLimitErrorAt` are read/written on account records and often cause full account file rewrites. | Metrics cache is loaded at startup, authoritative in memory, and flushed debounced/periodically. | Preserve fast allocator correctness without disk writes per request. | Abrupt crashes may lose the most recent unflushed telemetry window, which is accepted. |
| API account payloads | API routes serve scrubbed accounts directly from `loadStore()`. | API routes serve merged account+metrics views. | Keep frontend contract unchanged. | Dashboard and tests should observe the same response shape. |
| Store version | Version 2 accepts inline metric fields. | Version 3 strips inline metric fields and writes metrics sidecar on migration. | One-time cleanup for existing users. | Legacy inline metrics are preserved in `account-metrics.json`. |

### Metrics Store

Add `src/metrics-store.ts` as the sidecar store owner. It should:

- Resolve `account-metrics.json` using `path.join(path.dirname(getStorePath()), 'account-metrics.json')`.
- Load metrics at startup into an in-memory cache keyed by account alias.
- Provide helpers to get metrics, merge metrics into account/account-store views, update metrics, remove metrics for deleted accounts, and flush pending changes.
- Debounce or periodically flush dirty metrics to `account-metrics.json` using a safe full-file write pattern appropriate for a telemetry sidecar.
- Support immediate flush for migration and explicit shutdown flush.
- Preserve `rateLimitHistory` append semantics: create entries only from meaningful rate limits, deduplicate unchanged consecutive snapshots, and cap at 160 entries.

The metrics sidecar should contain only telemetry/history; credentials and account state remain in `accounts.json`. If the metrics file is missing or invalid, runtime should fall back to empty metrics and continue serving account state, logging a recoverable warning rather than locking the credential store.

### Field Classification

| Field | Store | Notes |
| --- | --- | --- |
| `alias` | State (`accounts.json`) | Account identity. |
| `accessToken`, `refreshToken`, `idToken` | State | Credentials; never move to metrics. |
| `accountId`, `accountUserId`, `userId`, `planType`, `expiresAt`, `email` | State | Account identity/token-derived durable state. |
| `rateLimitedUntil` | State | Blocking window used by allocator and request routing. It may be derived from metric `rateLimits`, but the derived blocking state remains durable account state. |
| `modelUnsupportedUntil`, `modelUnsupportedAt`, `modelUnsupportedModel`, `modelUnsupportedError` | State | Account availability/blocking state. |
| `workspaceDeactivatedUntil`, `workspaceDeactivatedAt`, `workspaceDeactivatedError` | State | Account availability/blocking state. |
| `authInvalid`, `authInvalidatedAt` | State | Authentication validity state. |
| `enabled`, `disabledAt`, `disabledBy`, `disableReason` | State | Operator-controlled account lifecycle state. |
| `tags`, `notes`, `source` | State | Operator/account metadata. |
| `lastRefresh` | Metrics (`account-metrics.json`) | Refresh timestamp/history signal; not required for credential validity because `expiresAt` remains state. |
| `lastSeenAt`, `lastActiveUntil` | Metrics | Activity telemetry from switching/selection. |
| `lastUsed`, `usageCount` | Metrics | Arguable because allocator reads them (`rotation.ts` least-used and priority logic), but they must be served from the startup-loaded in-memory metrics cache so allocator correctness is preserved without disk reads/writes per request. |
| `rateLimits`, `rateLimitHistory` | Metrics | Rate-limit snapshots and history are telemetry. |
| `limitStatus`, `limitError`, `lastLimitProbeAt`, `lastLimitErrorAt`, `limitsConfidence` | Metrics | Limit probe status and confidence telemetry. `lastLimitErrorAt` is arguable because allocator uses it for recent-failure scoring, but it must be available from the in-memory metrics cache. |

### Mixed-Write Split Strategy

Call sites that currently update both state and metrics must split updates deliberately:

- `index.ts` request-time `applyLimitUpdate`: write `rateLimits` to metrics and write only derived `rateLimitedUntil` to state.
- `limits-refresh.ts`: write `rateLimits`, `limitStatus`, `limitError`, `lastLimitProbeAt`, `lastLimitErrorAt`, and `limitsConfidence` to metrics; write `rateLimitedUntil`, `planType`, `authInvalid`, and `authInvalidatedAt` to state as applicable.
- `rotation.ts`: read allocator telemetry from merged/in-memory metrics views; write `usageCount`, `lastUsed`, `limitError`, and `lastLimitErrorAt` to metrics while preserving state writes such as `activeAlias`, `lastRotation`, `rotationIndex`, and `rateLimitedUntil`.
- `auth.ts` and `codex-auth.ts`: write credentials, token validity, identity, auth validity, and source to state; write `lastRefresh` and `lastSeenAt` to metrics.
- `store.ts` `addAccount()` and `updateAccount()`: stop persisting metric fields to `accounts.json`; route metric fields to the metrics store update path and keep state-only persistence for account records.
- `store.ts` `setActiveAlias()`: keep active alias/rotation state in `accounts.json`; write `lastSeenAt` and `lastActiveUntil` to metrics.
- `removeAccount()`: delete the account from `accounts.json` and remove corresponding metrics entry.
- `auto-login/auto_login.py`: remove `lastRefresh`, `lastSeenAt`, `usageCount`, and `rateLimitHistory` writes/preservation from the Python-created account payload.

### Backend Merge Contract

The dashboard API contract remains unchanged:

- `/api/state` should load account state plus metrics, merge the fields, scrub credentials, and return the same account objects the frontend currently expects.
- `/api/accounts` should also use merged views so fields such as `usageCount`, `rateLimits`, `limitStatus`, `limitError`, `lastLimitProbeAt`, `lastLimitErrorAt`, and `limitsConfidence` remain present.
- Internal helpers such as `recommendAlias()` should receive merged accounts when they rely on `rateLimits`.

### Migration v2 to v3

Migration must be automatic when loading a version 2 store:

1. Validate/load the existing store using current account validation rules.
2. Extract metric fields from each account into the sidecar metrics structure, preserving existing values and deriving/normalizing rate-limit history consistently with current validation.
3. Strip metric fields from account objects before saving `accounts.json` as version 3.
4. Write `account-metrics.json` immediately during migration so no inline metrics are lost.
5. Preserve encryption behavior for `accounts.json`; the metrics sidecar is telemetry-only and should be handled independently from credential encryption unless implementation discovers a current encryption convention that must apply to all sidecars.

Validation note: current account validation only requires `accessToken`, `refreshToken`, and `expiresAt`, so removing metrics fields must not break account validation.

## Affected Areas

- `src/store.ts`: version bump, metric-field stripping, migration orchestration, state-only `addAccount()`/`updateAccount()`/`setActiveAlias()`/`removeAccount()`, exported merged-load helper if hosted here.
- `src/metrics-store.ts`: new metrics sidecar, cache, merge helpers, history derivation, flush lifecycle.
- `src/types.ts`: type split between durable `AccountCredentials` state and metric fields, or compatible type helpers if retaining the public merged account type.
- `src/web.ts`: merge account state and metrics for `/api/state`, `/api/accounts`, `recommendAlias()`, and any web-side writes that currently set metric fields.
- `src/rotation.ts`: allocator reads/writes of `usageCount`, `lastUsed`, `limitError`, `lastLimitErrorAt`, and merged account views.
- `src/index.ts`: split `rateLimits` metric write from `rateLimitedUntil` state write in request-time limit updates; register flush hooks if this is the plugin entry path.
- `src/limits-refresh.ts`: split limit status/snapshot/confidence metric writes from auth/blocking state writes.
- `src/auth.ts` and `src/codex-auth.ts`: split token/account state from `lastRefresh`/`lastSeenAt` metrics.
- `auto-login/auto_login.py`: stop writing/preserving metrics keys in `accounts.json`.
- Tests and seed helpers: update account fixture setup to write both `accounts.json` and `account-metrics.json` where API-visible metrics are asserted. Known impacted areas include `tests/unit/store.test.ts`, `tests/integration/dashboard-api-contract.test.ts`, web-headless dashboard tests, `web` overview insights tests, and `DashboardPage.test.tsx`.

## Risks

- **Accepted telemetry loss on crash:** because metrics are debounced/periodically flushed, an abrupt crash may lose the latest unflushed telemetry window. This is acceptable because these fields are history/telemetry, not credentials or account state.
- **Allocator correctness:** `usageCount`, `lastUsed`, and `lastLimitErrorAt` influence selection. The in-memory metrics cache must be loaded before allocator decisions and used as the authoritative runtime source so behavior remains consistent within a process.
- **Mixed state/metrics writes:** fields such as `rateLimits` plus `rateLimitedUntil` are currently updated together. Splitting must avoid dropping the derived `rateLimitedUntil` state write when `rateLimits` moves to metrics.
- **API contract drift:** dashboard endpoints must continue returning the same fields; tests that assert `/api/state` and `/api/accounts` shape are high-value regression coverage.
- **Migration durability:** migration must not strip inline metrics from `accounts.json` unless `account-metrics.json` has been written successfully or the metrics are otherwise safely recoverable.
- **Test fixture drift:** many tests currently seed metrics inline in `accounts.json`; missing sidecar seeds can produce false regressions even when runtime merge is correct.
- **Encryption expectations:** `accounts.json` encryption currently protects credentials. Metrics are telemetry-only, but implementation should document sidecar behavior and ensure encrypted credential-store loading remains safe.

## Rollback Plan

- Revert the version bump and metrics sidecar integration if implementation regresses credential loading or routing.
- For users already migrated to version 3, rollback can reconstruct inline metrics by merging `account-metrics.json` entries back into `accounts.json` account objects and setting the store version back to 2, then removing or ignoring the sidecar.
- Because `/api/state` and `/api/accounts` response shapes are unchanged, frontend rollback should not be necessary unless merge behavior itself is faulty.
- If the sidecar is corrupt or missing, runtime should continue from account state with empty metrics, allowing operators to recover by deleting/regenerating `account-metrics.json` without touching credentials.

## Success Criteria

- `accounts.json` is not rewritten for request-time metric/history updates such as `rateLimits`, `rateLimitHistory`, `usageCount`, `lastUsed`, `limitStatus`, or `lastLimitErrorAt`.
- Durable account state changes still update `accounts.json`, including credentials, auth validity, enabled/disabled state, blocking windows, metadata, and derived `rateLimitedUntil`.
- `account-metrics.json` is created beside `accounts.json` and receives metric/history updates via debounced/periodic flush and shutdown flush.
- Allocator behavior remains semantically unchanged for least-used sorting, recent limit-error scoring, sticky selection updates, and forced-account paths by using startup-loaded in-memory metrics.
- `/api/state` and `/api/accounts` return the same account response shape as before, including metric fields merged from the sidecar.
- Loading a v2 `accounts.json` with inline metrics migrates to v3 by preserving metrics in `account-metrics.json` and stripping them from account objects.
- `auto-login/auto_login.py` no longer writes or preserves metric/history keys in `accounts.json`.
- Updated tests prove migration, merged API contract, split state/metrics writes, and no per-request credential-store rewrites for telemetry-only changes.

## Test / Verification Strategy

- Add unit tests for `metrics-store.ts`: path resolution, load empty/missing file, update/merge behavior, rate-limit history dedup/cap behavior, remove-account cleanup, debounced dirty state, and explicit flush.
- Add migration tests in `tests/unit/store.test.ts`: seed a v2 `accounts.json` with inline metrics, load the store, assert `accounts.json` is version 3 without metric fields, assert `account-metrics.json` contains the migrated metrics, and assert merged load/API view still exposes the same fields.
- Add or update tests that verify telemetry-only updates do not modify `accounts.json` while state updates still do. Include the mixed `rateLimits` + `rateLimitedUntil` case.
- Update dashboard API contract tests to seed both files and assert `/api/state` and `/api/accounts` keep their previous shape and values.
- Update web-headless/component fixtures that currently put metrics in account records to use a `seedSandbox()`-style helper capable of writing both `accounts.json` and `account-metrics.json`.
- Run targeted unit/integration suites for store migration, rotation/allocator behavior, limits refresh, dashboard API contract, and affected web tests.
- Manually inspect or test the Python auto-login output payload to confirm it writes account state only and does not recreate metric fields in `accounts.json`.
