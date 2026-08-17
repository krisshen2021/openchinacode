# OpenChinaCode Architecture

Orientation for the fork's live runtime. The experimental V2 session runtime, the `@opencode-ai/protocol` and `@opencode-ai/server` packages, and the `v2` CLI command were deleted in Phase 4 of the memory surgery (`docs/superpowers/plans/2026-08-16-memory-surgery.md`); this file replaces the old V2 vocabulary doc.

## Processes

- The TUI spawns-or-reuses a detached `serve` process and talks to it over localhost HTTP + SSE. The registry lives in `Global.Path.data/server.json` (ownership-guarded, version-matched, throwaway Basic password). `--in-process` keeps the old single-process worker path.
- TUI exit leaves the server running; sessions survive TUI restarts. TUI-spawned servers self-exit after 60 min fully idle; a manual `serve` stays resident unless `--idle-timeout` is passed.

## Server

- One Effect HttpApi hosted from `packages/opencode/src/server/server.ts`; the route tree lives under `src/server/routes/instance/httpapi` (patterns in that directory's `AGENTS.md`).
- V1 session services (`packages/opencode/src/session/*`) are instance-scoped per open directory via `InstanceState` and drive the live product: prompt loop, compaction, revert, todos, permissions.
- `EventV2` (`packages/core/src/event`) is the live event bus. `src/event-v2-bridge.ts` attaches the routed instance location to published events; the TUI consumes them over SSE.
- `SessionProjector` (`packages/core/src/session/projector.ts`) projects session events into durable SQLite tables (`packages/core/src/session/sql.ts`): sessions, messages, parts, inputs.
- Oversized tool output is bounded before entering session history; the complete text moves to managed tool-output files (`packages/core/src/tool-output-store.ts`).
- The ported `v2` route group (`httpapi/groups/v2.ts` + `handlers/v2.ts`) serves the surviving read-only `/api/*` surface: location-scoped lists (agent, command, integration, model, provider, reference, skill), `location.get`, `fs.find`, and `projectCopy.*`. Paths and wire shapes are byte-compatible with the deleted protocol groups so the generated v2 SDK keeps working unchanged.

## SDK

- The JS SDK (`packages/sdk/js`) is generated from the instance HttpApi's OpenAPI output. After changing the public HttpApi, run root `script/generate.ts`; never edit `packages/sdk/js/src/v2/gen` by hand.

## Possible future ports (from the deleted V2 experiment)

Phase 5 candidates — port one at a time into the V1 session services when they solve observed pain, not by ideology. See `docs/superpowers/plans/2026-08-16-memory-surgery.md` Phase 5.

- Durable prompt admission: a crash-safe session input inbox admitted before model execution.
- Explicit provider-turn boundaries: well-defined points where input and context changes become model-visible.
- Context-epoch baseline caching: an immutable rendered system-context baseline reused as the provider-cache prefix until compaction or session movement ends the epoch.
