# Live model discovery + TUI custom provider management — design

**Date:** 2026-08-21
**Status:** approved by user (2026-08-21), ready for implementation plan
**Scope:** `memory-surgery` branch, surgery worktree only. Approach A (live discovery) + user-required extensions: manual trigger for the three built-ins, TUI add/edit for custom providers with auto-pull OR manual model-id entry.

## Problem

When a provider releases a new model, making it usable today is manual and restart-gated:

- **Custom providers** (e.g. the user's `volcengine-agent-plan` relay): hand-edit `~/.config/<app>/openchinacode.jsonc`, typing a full `provider.<id>.models.<modelID>` entry (`reasoning`/`tool_call`/`limit`/`modalities`), then restart the TUI.
- **Built-in China trio** (zhipuai-pay2go / moonshotai-cn / deepseek): appears via models.dev refresh, but pricing/behavior live in hardcoded fork tables (`packages/core/src/models-dev.ts:131-230`).
- There is no generic runtime path that enumerates an OpenAI-compatible `GET /models` (only two bespoke precedents: github-copilot plugin `plugin/github-copilot/models.ts:213-256`, GitLab `discoverModels` in `provider.ts:642-707`).
- Connected-provider state is instance-lifetime cached (`provider.ts:1308-1627`, `InstanceState`), so a running instance never learns about new models without a restart.

## Grounded facts (verified during exploration)

- Global config merge order is `config.json → openchinacode.json → openchinacode.jsonc` (`packages/opencode/src/config/config.ts:260-262`) — **jsonc wins**. TUI writes MUST target the jsonc file, preserving comments via `jsonc-parser` `modify`/`applyEdits` (precedent: `config.ts:13`, `tui-migrate.ts:2`).
- apiKey storage already has HTTP endpoints: `authSet` / `authRemove` in `handlers/control.ts:13-41` (auth.json, mode 0600). Key precedence at runtime: `options.apiKey` > auth.json > env.
- Config provider schema: `packages/core/src/v1/config/provider.ts` — `Info` (80-124) accepts `api`, `name`, `npm`, `whitelist`/`blacklist`, `options` (incl. `baseURL`, arbitrary rest keys), `models` record; `Model` (9-78) all-optional metadata + arbitrary `options`.
- models.dev: build-time snapshot + runtime cache `~/.cache/<app>/models.json`, hourly background refresh fiber (`models-dev.ts:361-382`), fork filters catalog to the China trio via `openChinaCatalog` (`models-dev.ts:239-258`).
- TUI model picker: `packages/tui/src/component/dialog-model.tsx` reads `sync.data.provider` from `GET /provider`; provider connect dialog: `dialog-provider.tsx`.
- CLI: `openchinacode models [provider] [--refresh]` (`cli/cmd/models.ts:7-63`); `--refresh` currently only forces `ModelsDev.refresh`.
- The three built-ins and Volcengine Ark all expose OpenAI-style `GET {baseURL}/models` — except the user's Ark _plan_ endpoint, which apparently does not (user report). Manual entry must always be possible.

## Design

### 1. Discovery service (core of the feature)

New module `packages/opencode/src/provider/discover.ts` (opencode layer, provider domain — it needs HTTP + credentials + models.dev catalog):

- `discover(baseURL, apiKey): Effect<DiscoveredModel[], DiscoverError>` — `GET {baseURL}/models` with `Authorization: Bearer`, 10 s timeout. Parse the OpenAI shape `{data: [{id, ...}]}`, keep `id` (ignore the rest). Typed errors: `Unsupported` (404/405/non-JSON/unknown shape), `Auth` (401/403), `Network` (timeout/transport).
- **Metadata fallback chain** per discovered id:
  1. Same `id` in the effective models.dev catalog (cross-provider match, e.g. `glm-5.3` known from the zhipuai entry) → clone that metadata.
  2. Conservative defaults: `name = id`, `tool_call = true`, `reasoning = false`, `limit = {context: 128000, output: 8192}`.
  3. Explicit config `provider.<id>.models.<modelID>` entries always win over both (unchanged existing merge precedence).
- **Persistence:** discovered results cached at `~/.local/share/<app>/discovered-models.json` (`{providerID: {fetchedAt, models: DiscoveredModel[]}}`). Merge order at state build: defaults < discovered cache < fresh discovery < config. A dead endpoint after restart therefore loses nothing.
- **Never prune:** a model id that disappears from the endpoint list is kept (the endpoint may filter server-side). Discovery only adds.

### 2. Switch and scheduling

- New first-class config field `provider.<id>.discover_models?: boolean` in `packages/core/src/v1/config/provider.ts` `Info`. Built-in trio defaults **on**; custom providers default **off** (TUI-created providers get it set according to the user's "auto-pull" choice in the dialog).
- Cadence: one async pass at server boot (never blocks boot) + hourly, aligned with the existing ModelsDev refresh fiber. Providers lacking a resolvable baseURL or credential are skipped silently.

### 3. Manual trigger (CLI)

`openchinacode models --refresh` now does both: force `ModelsDev.refresh(true)` AND run one discovery pass for every discovery-enabled provider, printing newly added models. The existing positional `[provider]` argument scopes the discovery pass to that one provider. This covers the user's "manual trigger for the trio" requirement: `openchinacode models --refresh`.

### 4. HTTP endpoints

New handlers following `httpapi/AGENTS.md` (`HttpApiBuilder.group`, services yielded once at layer construction, declared `Schema.ErrorClass` error contracts):

- `POST /provider/discover` — body `{baseURL, apiKey}`. Probes the endpoint, returns `{models: string[]}` or a declared error with message. Used by the TUI "拉取模型" button before saving.
- `GET /provider/custom` — returns config-declared custom providers: `{id, name, baseURL, models: string[], discover_models}[]`. **Never returns apiKey.** Used to pre-fill the edit dialog.
- `PUT /provider/custom/:id` — body `{name?, baseURL, models: string[], discover_models, apiKey?}`. Writes `provider.<id>` into global `openchinacode.jsonc` via `jsonc-parser` edits (create the file with `$schema` if missing; entry shape: `{name?, npm: "@ai-sdk/openai-compatible", options: {baseURL}, discover_models, models: {<mid>: {name: <mid>}}}`). If `apiKey` present, stores it via `Auth.Service.set` (auth.json); on edit with blank key, keep the existing one. Edit = PUT with the same id. Triggers provider state rebuild (§6).

### 5. TUI flow

Extend the existing provider connect dialog (`dialog-provider.tsx`):

- New entry "自定义 provider…" → form: ID (slug; locked when editing), display name, baseURL, apiKey (password-style input; blank on edit = keep existing).
- **[拉取模型]** → `POST /provider/discover` → success: multi-select checklist of discovered ids (all selected by default) → save. Failure: inline error message + fall through to manual entry.
- **Manual entry**: textarea, one model id per line (comma also accepted); each becomes `{name: id}` with default metadata.
- **[保存]** → `PUT /provider/custom/:id` (+ `authSet`) → toast confirmation → picker updates **without restart**.
- Existing custom providers listed with an Edit action opening the same dialog pre-filled from `GET /provider/custom`.
- No delete UI (v1) — remove the jsonc entry by hand.

### 6. Live pickup without restart (the internal linchpin)

- After any discovery refresh or `PUT /provider/custom`, publish a `provider.updated` event on the global event bus.
- The `Provider` InstanceState subscribes and rebuilds its state (re-running the same merge pipeline used at instance build).
- TUI `sync` already maintains `provider` data from `GET /provider`; it must re-fetch on `provider.updated` so the picker reflects new models immediately.
- Session model resolution reads the rebuilt state, so a newly discovered model is selectable/runnable right away.

### 7. Error handling

- Discovery pass failure: one warn log per cycle per provider, keep previous cache, retry next cycle. Boot is never blocked (async fiber).
- 401/403 → log/inline hint to check the apiKey.
- 404/405/unknown shape → "endpoint does not support enumeration" — guides the user to manual entry (the Volcengine plan case).
- TUI probe errors shown inline with the server-returned message.

### 8. Testing

- Discovery parser: standard OpenAI shape, missing `data`, non-JSON body, 401, 404, timeout (stub HTTP).
- Fallback merge chain: catalog hit vs defaults vs config override; cache write/read; never-prune.
- jsonc write: comment preservation, file creation, edit-in-place, precedence over `openchinacode.json`.
- Endpoint contract tests for the three new routes.
- `models --refresh` combined behavior.
- Acceptance smoke (compiled binary): add custom provider in TUI → pull models → appears in picker without restart → send one prompt to a discovered model; also manual-id path; also `openchinacode models --refresh` CLI output.

## Non-goals

- Config-driven pricing overrides (approach B) — separate future task.
- Per-model metadata editing in the TUI (config file remains the advanced path).
- Provider deletion UI.
- Pruning models that vanish from an endpoint.
- Non-OpenAI discovery protocols.
- Touching `china-transform.ts`, pricing tables, or the hardcoded `kimi-k3` injection.
