# Live model discovery + TUI custom provider management — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly released models usable without hand-editing config or restarting: OpenAI-compatible `GET /models` discovery for built-in trio + custom providers, manual refresh triggers (TUI + CLI), and a TUI dialog to add/edit custom providers (auto-pull or manual model ids).

**Architecture:** Discovery results are persisted to a per-app JSON cache and merged into the Provider instance state at build time (same merge point as the existing GitLab `discoverModels` precedent, `provider.ts:1559-1571`). Live pickup is achieved via a new surgical `Provider.refresh()` (wraps `InstanceState.invalidate`) invoked by the new HTTP endpoints; the TUI re-fetches afterwards. Spec: `docs/superpowers/specs/2026-08-21-live-model-discovery-design.md`.

**Tech Stack:** Effect (v4 beta API — `Effect.forkIn(scope)`, no `Effect.fork`), Effect Schema, `effect/unstable/httpapi` HttpApiBuilder groups, drizzle/bun:sqlite (not touched here), SolidJS TUI (`packages/tui`), `jsonc-parser` `modify`/`applyEdits` for comment-preserving config writes.

**Hard rules (repo):**

- Work only in `/home/kris/Projects/OpenChinaCode-surgery` on branch `memory-surgery`. Never touch `/home/kris/Projects/OpenChinaCode`.
- Run tests/typecheck from package dirs (`packages/core`, `packages/opencode`, `packages/tui`), NEVER repo root.
- `bun typecheck` per touched package (never bare `tsc`).
- No mocks, no `globalThis.*` in tests — use real implementations (spin up `Bun.serve` on port 0 for HTTP stubs).
- After changing the Server `HttpApi`, regenerate the SDK: `cd packages/client && bun run generate`. Never edit `src/generated*` by hand.
- Follow `packages/opencode/AGENTS.md` (module shape: flat exports + `export * as Foo from "./foo"` self-reexport, Effect rules) and `packages/opencode/src/server/routes/instance/httpapi/AGENTS.md` (HttpApiBuilder.group pattern, declared error schemas).
- Conventional commits on `memory-surgery`. Only `git add`/`commit` — nothing else.

---

### Task 1: Config field `discover_models`

**Files:**

- Modify: `packages/core/src/v1/config/provider.ts:80-124` (the `Info` struct)

- [ ] **Step 1: Add the field**

In `packages/core/src/v1/config/provider.ts`, add to `Info` after `blacklist` (line 87):

```ts
      discover_models: Schema.optional(Schema.Boolean).annotate({
        description:
          "Fetch the model list from this provider's OpenAI-compatible GET {baseURL}/models endpoint at provider-state build (cached 1h on disk). Built-in China providers default to true; custom providers default to false. Explicitly declared models always take precedence over discovered ones.",
      }),
```

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/core && bun typecheck`
Expected: clean.

```bash
git add packages/core/src/v1/config/provider.ts
git commit -m "feat(core): add provider discover_models config flag"
```

---

### Task 2: Discovery core — fetch + disk cache

**Files:**

- Create: `packages/opencode/src/provider/discover.ts`
- Test: `packages/opencode/test/provider/discover.test.ts`

Module shape per `packages/opencode/AGENTS.md`: flat top-level exports, `export * as Discover from "./discover"` at the bottom of the file. No Effect service needed — these are plain functions/effects used by `provider.ts` and the HTTP handlers.

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/provider/discover.test.ts`. Read `packages/opencode/test/AGENTS.md` first and follow it: `testEffect` harness, `it.live` for real filesystem/network, `tmpdir` fixture. Match the import style of neighboring tests (`test/storage/storage.test.ts` imports services as `@opencode-ai/core/fs-util` and the harness as `../lib/effect`, `../fixture/fixture`).

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Discover } from "@/provider/discover"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(FSUtil.node))

// fetchModels needs no Effect services, so these tests stay promise-style.
const withServer = <A>(handler: (req: Request) => Response | Promise<Response>, fn: (port: number) => Promise<A>) =>
  (async () => {
    const server = Bun.serve({ port: 0, fetch: handler })
    try {
      return await fn(server.port)
    } finally {
      server.stop(true)
    }
  })()

describe("Discover.fetchModels", () => {
  it("parses the OpenAI shape and keeps id + name", async () => {
    const models = await withServer(
      () =>
        Response.json({
          object: "list",
          data: [{ id: "glm-5.4", object: "model", created: 1, owned_by: "zhipu" }, { id: "glm-5.3-air" }],
        }),
      (port) => Effect.runPromise(Discover.fetchModels(`http://127.0.0.1:${port}/v4`, "sk-test")),
    )
    expect(models).toEqual([
      { id: "glm-5.4", name: "glm-5.4" },
      { id: "glm-5.3-air", name: "glm-5.3-air" },
    ])
  })

  it("sends the bearer key", async () => {
    let seen: string | null = null
    const models = await withServer(
      (req) => {
        seen = req.headers.get("authorization")
        return Response.json({ data: [{ id: "m1" }] })
      },
      (port) => Effect.runPromise(Discover.fetchModels(`http://127.0.0.1:${port}`, "sk-secret")),
    )
    expect(seen).toBe("Bearer sk-secret")
    expect(models).toHaveLength(1)
  })

  it("fails with Auth on 401", async () => {
    const exit = await withServer(
      () => new Response("unauthorized", { status: 401 }),
      (port) => Effect.runPromiseExit(Discover.fetchModels(`http://127.0.0.1:${port}`, "bad")),
    )
    expect(String(exit)).toContain("Auth")
  })

  it("fails with Unsupported on 404 and on non-JSON bodies", async () => {
    for (const response of [new Response("nope", { status: 404 }), new Response("<html>", { status: 200 })]) {
      const exit = await withServer(
        () => response,
        (port) => Effect.runPromiseExit(Discover.fetchModels(`http://127.0.0.1:${port}`, "k")),
      )
      expect(String(exit)).toContain("Unsupported")
    }
  })

  it("fails with Network on connection refused", async () => {
    const exit = await Effect.runPromiseExit(Discover.fetchModels("http://127.0.0.1:1", "k"))
    expect(String(exit)).toContain("Network")
  })
})

describe("Discover cache", () => {
  it.live("round-trips entries and reports TTL freshness", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        const cache = yield * Discover.makeCache(tmp.path)
        yield * cache.write("zhipuai-pay2go", [{ id: "glm-5.4", name: "glm-5.4" }])
        const fresh = yield * cache.read()
        expect(fresh["zhipuai-pay2go"].models).toEqual([{ id: "glm-5.4", name: "glm-5.4" }])
        expect(cache.isFresh(fresh["zhipuai-pay2go"])).toBe(true)
        yield * cache.expire("zhipuai-pay2go")
        const expired = yield * cache.read()
        expect(cache.isFresh(expired["zhipuai-pay2go"])).toBe(false)
      })
    }),
  )

  it.live("treats a missing cache file as empty", () =>
    Effect.gen(function* () {
      const cache = yield* Discover.makeCache("/tmp/discover-test-nonexistent-dir")
      const data = yield* cache.read()
      expect(data).toEqual({})
    }),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/provider/discover.test.ts`
Expected: FAIL — `@/provider/discover` does not exist.

- [ ] **Step 3: Implement `discover.ts`**

Create `packages/opencode/src/provider/discover.ts`:

```ts
export * as Discover from "./discover"

import path from "path"
import { Duration, Effect, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const TTL = Duration.toMillis(Duration.hours(1))
export const CACHE_FILE = "discovered-models.json"

export const Model = Schema.Struct({ id: Schema.String, name: Schema.String })
export type Model = Schema.Schema.Type<typeof Model>

export const CacheData = Schema.Record(
  Schema.String,
  Schema.Struct({ fetchedAt: Schema.Number, models: Schema.mutable(Schema.Array(Model)) }),
)
export type CacheData = Schema.Schema.Type<typeof CacheData>

export class DiscoverError extends Schema.TaggedErrorClass<DiscoverError>()("DiscoverError", {
  kind: Schema.Literals(["Unsupported", "Auth", "Network"]),
  message: Schema.String,
}) {}

const fail = (kind: "Unsupported" | "Auth" | "Network", message: string) => new DiscoverError({ kind, message })

/**
 * Fetches the model list from an OpenAI-compatible `GET {baseURL}/models`.
 * Keeps only the model id (display name falls back to the id); unknown fields
 * are ignored so relay endpoints with extra payload still parse.
 */
export const fetchModels = Effect.fn("Discover.fetchModels")(function* (baseURL: string, apiKey: string) {
  const url = `${baseURL.replace(/\/+$/, "")}/models`
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }),
    catch: () => fail("Network", `GET ${url} failed (timeout or transport error)`),
  })
  if (response.status === 401 || response.status === 403) {
    return yield* fail("Auth", `GET ${url} returned ${response.status}; check the API key`)
  }
  if (!response.ok) {
    return yield* fail(
      "Unsupported",
      `GET ${url} returned ${response.status}; endpoint does not support model enumeration`,
    )
  }
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => fail("Unsupported", `GET ${url} did not return JSON; endpoint does not support model enumeration`),
  })
  const parsed = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }),
  )(body).pipe(Effect.mapError(() => fail("Unsupported", `GET ${url} returned an unrecognized shape`)))
  return parsed.data.map((model) => ({ id: model.id, name: model.id }))
})

export interface Cache {
  readonly read: () => Effect.Effect<CacheData>
  readonly write: (providerID: string, models: Model[]) => Effect.Effect<void>
  readonly expire: (providerID: string) => Effect.Effect<void>
  readonly isFresh: (entry: { fetchedAt: number } | undefined) => boolean
}

/** Cache is a plain factory (not an Effect service) so tests can point it at a temp dir. */
export const makeCache = (dir: string) =>
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const file = path.join(dir, CACHE_FILE)
    const decode = Schema.decodeUnknownEffect(CacheData)

    const read = Effect.fnUntraced(function* () {
      const raw = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
      return yield* decode(raw).pipe(Effect.orElseSucceed(() => ({})))
    })

    const write = Effect.fnUntraced(function* (providerID: string, models: Model[]) {
      const data = yield* read()
      yield* fsys
        .writeJson(file, { ...data, [providerID]: { fetchedAt: Date.now(), models } }, 0o600)
        .pipe(Effect.orDie)
    })

    const expire = Effect.fnUntraced(function* (providerID: string) {
      const data = yield* read()
      const entry = data[providerID]
      if (!entry) return
      yield* fsys.writeJson(file, { ...data, [providerID]: { ...entry, fetchedAt: 0 } }, 0o600).pipe(Effect.orDie)
    })

    const isFresh = (entry: { fetchedAt: number } | undefined) =>
      entry !== undefined && Date.now() - entry.fetchedAt < TTL

    return { read, write, expire, isFresh } satisfies Cache
  })
```

Check `FSUtil.Service` has `readJson`/`writeJson` (it does — `packages/opencode/src/auth/index.ts:65,79` uses both with the same signatures).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/opencode && bun test test/provider/discover.test.ts`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/provider/discover.ts packages/opencode/test/provider/discover.test.ts
git commit -m "feat(opencode): add OpenAI-compatible model discovery with disk cache"
```

---

### Task 3: Discovery core — merge fallback chain

**Files:**

- Modify: `packages/opencode/src/provider/discover.ts`
- Test: `packages/opencode/test/provider/discover.test.ts` (append)

The state `Model` shape (see the hand-built example in `provider.ts:660-699`) differs from the models-dev `Model` schema. Merge logic: for each discovered id not already in `provider.models`, build a state model by (1) cloning the cross-provider catalog match converted via the existing `fromModelsDevProvider` model conversion, or (2) conservative defaults.

- [ ] **Step 1: Write the failing test (append to discover.test.ts)**

```ts
describe("Discover.mergeInto", () => {
  const stateModel = (id: string, name = id): any => ({
    id,
    providerID: "volcengine-agent-plan",
    name,
    family: "",
    api: { id, url: "https://ark.example/v3", npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  })

  it("adds discovered models with defaults, never overwriting existing ones", () => {
    const provider: any = { models: { declared: stateModel("declared") } }
    Discover.mergeInto(
      provider,
      [
        { id: "declared", name: "declared" },
        { id: "new-model", name: "new-model" },
      ],
      undefined,
    )
    expect(Object.keys(provider.models).sort()).toEqual(["declared", "new-model"])
    expect(provider.models["new-model"].limit.context).toBe(128000)
    expect(provider.models["new-model"].capabilities.toolcall).toBe(true)
  })

  it("clones metadata from a catalog match when provided", () => {
    const provider: any = { models: {} }
    const catalogHit: any = stateModel("glm-5.4", "GLM 5.4")
    catalogHit.limit = { context: 200000, output: 128000 }
    Discover.mergeInto(provider, [{ id: "glm-5.4", name: "glm-5.4" }], (id: string) =>
      id === "glm-5.4" ? catalogHit : undefined,
    )
    expect(provider.models["glm-5.4"].limit.context).toBe(200000)
    expect(provider.models["glm-5.4"].name).toBe("GLM 5.4")
  })
})

describe("Discover.enabled", () => {
  it("defaults on for the built-in trio, off for custom, config wins", () => {
    expect(Discover.enabled(undefined, "zhipuai-pay2go")).toBe(true)
    expect(Discover.enabled(undefined, "moonshotai-cn")).toBe(true)
    expect(Discover.enabled(undefined, "deepseek")).toBe(true)
    expect(Discover.enabled(undefined, "volcengine-agent-plan")).toBe(false)
    expect(Discover.enabled({ discover_models: false }, "zhipuai-pay2go")).toBe(false)
    expect(Discover.enabled({ discover_models: true }, "volcengine-agent-plan")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/provider/discover.test.ts`
Expected: FAIL — `Discover.mergeInto`/`Discover.enabled` are not functions.

- [ ] **Step 3: Implement**

Append to `discover.ts` (before the `export * as` line — move that line to the bottom if needed):

```ts
const BUILTIN_DISCOVERY = ["zhipuai-pay2go", "moonshotai-cn", "deepseek"]

export const enabled = (config: { discover_models?: boolean } | undefined, providerID: string): boolean =>
  config?.discover_models ?? BUILTIN_DISCOVERY.includes(providerID)

/**
 * Merges discovered models into a provider state model map. Never overwrites
 * existing entries (config-declared or previously merged). `catalogHit` is the
 * state-shaped model cloned from a cross-provider models.dev match; when
 * absent, conservative defaults are used (128k/8k, toolcall on).
 */
export const mergeInto = (
  provider: { models: Record<string, unknown> },
  discovered: Model[],
  catalogHit: ((id: string) => unknown | undefined) | undefined,
) => {
  for (const model of discovered) {
    if (provider.models[model.id]) continue
    const hit = catalogHit?.(model.id)
    if (hit) {
      provider.models[model.id] = hit
      continue
    }
    provider.models[model.id] = {
      id: model.id,
      name: model.name,
      family: "",
      api: { id: model.id },
      status: "active",
      headers: {},
      options: {},
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 128000, output: 8192 },
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      release_date: "",
      variants: {},
    }
  }
}
```

Note: the default model's `api`/`providerID` fields are completed by the caller in Task 4, which knows the provider's npm package and base URL (mirror what `provider.ts:1404-1420` does for config models: `model.api.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"`, `model.api.url ?? provider api url`). The test above asserts only the invariant parts; adjust the exact default shape to the real `Model` type when wiring (the GitLab block at `provider.ts:660-699` is the authoritative shape reference — match it).

- [ ] **Step 4: Run test**

Run: `cd packages/opencode && bun test test/provider/discover.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/provider/discover.ts packages/opencode/test/provider/discover.test.ts
git commit -m "feat(opencode): add discovery merge fallback chain"
```

---

### Task 4: Provider state-build integration + `Provider.refresh()`

**Files:**

- Modify: `packages/opencode/src/provider/provider.ts` (state build ~1308-1627, Interface definition, `list` at 1630)
- Test: `packages/opencode/test/provider/discover-build.test.ts` (new) — or extend an existing provider test file if one exists (check `packages/opencode/test/provider/` first and follow its harness)

- [ ] **Step 1: Locate the Interface and state internals**

Find the `Interface` for `Provider.Service` (search `export interface Interface` in `provider.ts`) and the `list` implementation at line 1630 (`InstanceState.use(state, (s) => s.providers)`). The `state` InstanceState is created at line 1308.

- [ ] **Step 2: Add discovery into the state build**

In `provider.ts`, replace the GitLab-only discovery block (lines 1559-1571) with a generalized pass that keeps the GitLab behavior and adds generic discovery. Insert after the config re-apply loop (line 1557), before the filtering loop (line 1573):

```ts
// generic OpenAI-compatible discovery (built-in trio defaults on, see Discover.enabled)
const discoverCache = yield * Discover.makeCache(Global.Path.data)
const discoveredData = yield * discoverCache.read()
for (const [id, provider] of Object.entries(providers)) {
  const providerID = ProviderV2.ID.make(id)
  if (!isProviderAllowed(providerID)) continue
  if (!Discover.enabled(cfg.provider?.[id], id)) continue
  const entry = discoveredData[id]
  const models =
    yield *
    Effect.gen(function* () {
      if (discoverCache.isFresh(entry)) return entry.models
      const baseURL = (typeof provider.options?.baseURL === "string" && provider.options.baseURL) || provider.api?.url
      const key =
        (typeof provider.options?.apiKey === "string" && provider.options.apiKey) ||
        (yield* dep.auth(id).pipe(
          Effect.map((a) => (a?.type === "api" ? a.key : undefined)),
          Effect.orDie,
        ))
      if (!baseURL || !key) return entry?.models ?? []
      const fetched = yield* Discover.fetchModels(baseURL, key).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("model discovery failed", { provider: id, kind: error.kind, message: error.message }),
        ),
        Effect.orElseSucceed(() => entry?.models ?? []),
      )
      if (fetched.length > 0 && fetched !== (entry?.models ?? [])) yield* discoverCache.write(id, fetched)
      return fetched
    })
  Discover.mergeInto(provider, models, (modelID) => catalogModel(id, modelID))
}
```

Where `catalogModel(providerID, modelID)` is a small helper inside the same closure that converts a cross-provider models-dev catalog hit into the state model shape: search `catalog` (already built at line 1313 from `fromModelsDevProvider`) for any provider whose `models[modelID]` exists, then clone it and rewrite `providerID`/`api.npm`/`api.url` to the current provider's values (npm resolution exactly like line 1404-1409: `model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"`). For the GitLab block being replaced: keep its exact behavior by folding it into the same loop — `if (discoveryLoaders[providerID])` run that loader and merge its results first (it returns full state models already), then run the generic path. If folding makes the loop hard to read, keep the GitLab block verbatim and add the generic loop after it; DO NOT change GitLab semantics.

Also give the default-shaped models from `Discover.mergeInto` their provider-specific fields right after merging (iterate newly added ids): set `providerID`, `api.npm` (same resolution as above), `api.url = baseURL`.

Watch out: `Global` needs `import { Global } from "@opencode-ai/core/global"`; `Discover` needs `import { Discover } from "@/provider/discover"`.

- [ ] **Step 3: Add `Provider.refresh()`**

Add to the Provider `Interface`:

```ts
  readonly refresh: () => Effect.Effect<void>
```

Implement next to `list` (line 1630):

```ts
const refresh = Effect.fn("Provider.refresh")(() => InstanceState.invalidate(state))
```

and add `refresh` to the `Service.of({ ... })` return value (search for where `list` is returned).

- [ ] **Step 4: Test**

Follow the existing provider test harness in `packages/opencode/test/` (look for tests that build Provider state with a temp global dir; if none exists, cover Task 4 via the HTTP-level tests in Task 6 and skip a dedicated unit test — do NOT invent a new harness). At minimum assert: with a stub `/models` server (same `withServer` pattern as Task 2), a provider configured with `discover_models: true` and that baseURL picks up the stub's models on `Provider.list()`; with `discover_models: false` it does not; a config-declared model with the same id keeps its own metadata.

Run: `cd packages/opencode && bun test test/provider/`
Expected: pass.

- [ ] **Step 5: typecheck + commit**

Run: `cd packages/opencode && bun typecheck`
Expected: clean.

```bash
git add packages/opencode/src/provider/provider.ts packages/opencode/test/
git commit -m "feat(opencode): merge discovered models into provider state, add Provider.refresh"
```

---

### Task 5: Config writer for custom providers

**Files:**

- Create: `packages/opencode/src/config/custom-provider.ts`
- Test: `packages/opencode/test/config/custom-provider.test.ts`

- [ ] **Step 1: Write the failing test**

`save`/`list` need the real `FSUtil` — use the `testEffect` harness with `it.live` and the `tmpdir` fixture per `test/AGENTS.md`:

```ts
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { readFile, writeFile } from "node:fs/promises"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CustomProvider } from "@/config/custom-provider"
import { testEffect } from "../lib/effect"
import { tmpdir } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(FSUtil.node))

describe("CustomProvider.save", () => {
  it.live("creates openchinacode.jsonc when missing", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        await Effect.runPromise(
          CustomProvider.save(tmp.path, {
            id: "volcengine-agent-plan",
            name: "Volcengine Ark",
            baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
            models: ["glm-5.3", "kimi-k3"],
            discover_models: false,
          }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
        )
        const written = JSON.parse(await readFile(path.join(tmp.path, "openchinacode.jsonc"), "utf8"))
        expect(written.provider["volcengine-agent-plan"].npm).toBe("@ai-sdk/openai-compatible")
        expect(written.provider["volcengine-agent-plan"].options.baseURL).toBe(
          "https://ark.cn-beijing.volces.com/api/plan/v3",
        )
        expect(Object.keys(written.provider["volcengine-agent-plan"].models)).toEqual(["glm-5.3", "kimi-k3"])
        expect(written.provider["volcengine-agent-plan"].discover_models).toBe(false)
      })
    }),
  )

  it.live("edits in place, preserving comments and unrelated keys", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        const file = path.join(tmp.path, "openchinacode.jsonc")
        await writeFile(
          file,
          `{
  // my default model
  "model": "zhipuai-pay2go/glm-5.2",
  "provider": {
    "volcengine-agent-plan": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "https://old.example/v3" },
      "models": { "glm-5.3": { "name": "glm-5.3" } }
    }
  }
}
`,
        )
        await Effect.runPromise(
          CustomProvider.save(tmp.path, {
            id: "volcengine-agent-plan",
            baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
            models: ["glm-5.4"],
            discover_models: true,
          }).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
        )
        const text = await readFile(file, "utf8")
        expect(text).toContain("// my default model")
        const written = JSON.parse(text)
        expect(written.model).toBe("zhipuai-pay2go/glm-5.2")
        expect(written.provider["volcengine-agent-plan"].options.baseURL).toBe(
          "https://ark.cn-beijing.volces.com/api/plan/v3",
        )
        expect(Object.keys(written.provider["volcengine-agent-plan"].models)).toEqual(["glm-5.4"])
        expect(written.provider["volcengine-agent-plan"].discover_models).toBe(true)
      })
    }),
  )

  it.live("lists config-declared custom providers without apiKey", () =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await using tmp = await tmpdir()
        const file = path.join(tmp.path, "openchinacode.jsonc")
        await writeFile(
          file,
          JSON.stringify({
            provider: {
              mine: {
                npm: "@ai-sdk/openai-compatible",
                options: { baseURL: "https://x.example/v1", apiKey: "SECRET" },
                discover_models: true,
                models: { m1: { name: "m1" } },
              },
            },
          }),
        )
        const list = await Effect.runPromise(
          CustomProvider.list(tmp.path).pipe(Effect.provide(LayerNode.compile(FSUtil.node))),
        )
        expect(list).toEqual([
          { id: "mine", name: undefined, baseURL: "https://x.example/v1", models: ["m1"], discover_models: true },
        ])
        expect(JSON.stringify(list)).not.toContain("SECRET")
      })
    }),
  )
})
```

If `save`/`list` end up needing more than `FSUtil`, yield the services inside `it.live` bodies directly instead of the inner `Effect.provide` (adjust to taste — assertions are the contract). `list` treats a provider as "custom" when its config entry has `options.baseURL` and it is NOT one of the models.dev built-ins — for the test the simple rule "has options.baseURL" is fine; the handler in Task 6 can refine.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/opencode && bun test test/config/custom-provider.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `custom-provider.ts`**

Shape (follow `tui-migrate.ts` for the jsonc-parser usage pattern):

```ts
export * as CustomProvider from "./custom-provider"

import path from "path"
import { Effect } from "effect"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { FSUtil } from "@opencode-ai/core/fs-util"

export interface Input {
  readonly id: string
  readonly name?: string
  readonly baseURL: string
  readonly models: readonly string[]
  readonly discover_models: boolean
}

export interface Entry {
  readonly id: string
  readonly name?: string
  readonly baseURL: string
  readonly models: string[]
  readonly discover_models: boolean
}

const FILE = "openchinacode.jsonc"

export const save = Effect.fn("CustomProvider.save")(function* (dir: string, input: Input) {
  const fsys = yield* FSUtil.Service
  const file = path.join(dir, FILE)
  const text = yield* fsys.readFile(file).pipe(Effect.orElseSucceed(() => ""))
  const base = text.trim() ? text : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  const models: Record<string, { name: string }> = {}
  for (const id of input.models) models[id] = { name: id }
  const entry: Record<string, unknown> = {
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: input.baseURL },
    discover_models: input.discover_models,
    models,
  }
  if (input.name) entry.name = input.name
  const edits = modify(base, ["provider", input.id], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  yield* fsys.writeFile(file, applyEdits(base, edits)).pipe(Effect.orDie)
})

export const list = Effect.fn("CustomProvider.list")(function* (dir: string) {
  const fsys = yield* FSUtil.Service
  const file = path.join(dir, FILE)
  const text = yield* fsys.readFile(file).pipe(Effect.orElseSucceed(() => ""))
  if (!text.trim()) return [] as Entry[]
  const parsed = parseJsonc(text) as { provider?: Record<string, any> }
  return Object.entries(parsed.provider ?? {})
    .filter(([, value]) => typeof value?.options?.baseURL === "string")
    .map(([id, value]) => ({
      id,
      name: value.name,
      baseURL: value.options.baseURL,
      models: Object.keys(value.models ?? {}),
      discover_models: value.discover_models ?? false,
    }))
})
```

Verify `FSUtil.Service` exposes `readFile`/`writeFile` (check `packages/core/src/fs-util.ts` — if the method names differ, adapt; `readJson`/`writeJson` are confirmed to exist). Never read or return `options.apiKey` in `list`.

- [ ] **Step 4: Run test**

Run: `cd packages/opencode && bun test test/config/custom-provider.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/config/custom-provider.ts packages/opencode/test/config/custom-provider.test.ts
git commit -m "feat(opencode): add jsonc custom provider config writer"
```

---

### Task 6: HTTP endpoints

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts`
- Test: `packages/opencode/test/server/httpapi-provider-discovery.test.ts` (new — follow the harness in `test/server/httpapi-instance.test.ts`)

Follow `httpapi/AGENTS.md`: `HttpApiBuilder.group`, services yielded once at handler-layer construction, declared `Schema.ErrorClass` for public errors. Add a new error class next to `ProviderAuthApiError` in `groups/provider.ts`:

```ts
export class ProviderDiscoveryApiError extends Schema.ErrorClass<ProviderDiscoveryApiError>("ProviderDiscoveryError")(
  {
    kind: Schema.Literals(["Unsupported", "Auth", "Network", "BadRequest"]),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}
```

- [ ] **Step 1: Declare the endpoints in `groups/provider.ts`**

Inside the same `HttpApiGroup.make("provider")` chain (after `callback`):

```ts
        HttpApiEndpoint.post("discover", `${root}/discover`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ baseURL: Schema.String, apiKey: Schema.String }),
          success: described(Schema.Struct({ models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }), "Discovered models"),
          error: ProviderDiscoveryApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "provider.discover", summary: "Probe an OpenAI-compatible endpoint for its model list" })),
        HttpApiEndpoint.get("customList", `${root}/custom`, {
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.Array(
              Schema.Struct({
                id: Schema.String,
                name: Schema.optional(Schema.String),
                baseURL: Schema.String,
                models: Schema.Array(Schema.String),
                discover_models: Schema.Boolean,
              }),
            ),
            "Custom providers declared in config",
          ),
        }).annotateMerge(OpenApi.annotations({ identifier: "provider.custom.list", summary: "List config-declared custom providers (never includes apiKey)" })),
        HttpApiEndpoint.put("customSave", `${root}/custom/:providerID`, {
          params: { providerID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({
            name: Schema.optional(Schema.String),
            baseURL: Schema.String,
            models: Schema.Array(Schema.String),
            discover_models: Schema.Boolean,
            apiKey: Schema.optional(Schema.String),
          }),
          success: described(Schema.Struct({ ok: Schema.Literal(true) }), "Saved"),
          error: ProviderDiscoveryApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "provider.custom.save", summary: "Create or update a custom provider in the global config" })),
        HttpApiEndpoint.post("refresh", `${root}/refresh`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ added: Schema.Array(Schema.String) }), "Newly discovered models"),
        }).annotateMerge(OpenApi.annotations({ identifier: "provider.refresh", summary: "Refresh models.dev and discovered models, rebuilding provider state" })),
```

- [ ] **Step 2: Implement the handlers in `handlers/provider.ts`**

Yield the additional services once at the top of the group (`Auth.Service` from `@/auth`, `ModelsDev.Service` is already used via `ModelsDev.Service.use`, `Global` for the config dir path):

```ts
const discover = Effect.fn("ProviderHttpApi.discover")(function* (ctx: {
  payload: { baseURL: string; apiKey: string }
}) {
  const models = yield* Discover.fetchModels(ctx.payload.baseURL, ctx.payload.apiKey).pipe(
    Effect.mapError((error) => new ProviderDiscoveryApiError({ kind: error.kind, message: error.message })),
  )
  return { models }
})

const customList = Effect.fn("ProviderHttpApi.customList")(function* () {
  return yield* CustomProvider.list(Global.Path.config).pipe(Effect.orDie)
})

const customSave = Effect.fn("ProviderHttpApi.customSave")(function* (ctx: {
  params: { providerID: string }
  payload: { name?: string; baseURL: string; models: string[]; discover_models: boolean; apiKey?: string }
}) {
  if (!ctx.params.providerID.match(/^[a-z0-9][a-z0-9-]*$/)) {
    return yield* new ProviderDiscoveryApiError({
      kind: "BadRequest",
      message: "provider id must be lowercase letters, digits, hyphens",
    })
  }
  if (ctx.payload.models.length === 0) {
    return yield* new ProviderDiscoveryApiError({ kind: "BadRequest", message: "at least one model id is required" })
  }
  yield* CustomProvider.save(Global.Path.config, {
    id: ctx.params.providerID,
    name: ctx.payload.name,
    baseURL: ctx.payload.baseURL,
    models: ctx.payload.models,
    discover_models: ctx.payload.discover_models,
  }).pipe(Effect.orDie)
  if (ctx.payload.apiKey) {
    yield* auth.set(ctx.params.providerID, { type: "api", key: ctx.payload.apiKey }).pipe(Effect.orDie)
  }
  yield* provider.refresh()
  return { ok: true as const }
})

const refresh = Effect.fn("ProviderHttpApi.refresh")(function* () {
  const before = new Set(
    Object.entries(yield* provider.list()).flatMap(([pid, p]) => Object.keys(p.models).map((m) => `${pid}/${m}`)),
  )
  yield* ModelsDev.Service.use((s) => s.refresh(true))
  const discoverCache = yield* Discover.makeCache(Global.Path.data)
  for (const id of Object.keys(yield* provider.list())) {
    yield* discoverCache.expire(id)
  }
  yield* provider.refresh()
  const after = yield* provider.list()
  const added = Object.entries(after)
    .flatMap(([pid, p]) => Object.keys(p.models).map((m) => `${pid}/${m}`))
    .filter((key) => !before.has(key))
  return { added }
})
```

Then chain them: `handlers.handle("discover", discover).handle("customList", customList).handle("customSave", customSave).handle("refresh", refresh)` after the existing `.handle("callback", callback)`.

Note `auth` name is already taken by the existing `auth` handler const — bind the service as `const authSvc = yield* Auth.Service` to avoid collision.

- [ ] **Step 3: Write endpoint tests**

Follow `test/server/httpapi-instance.test.ts` harness (it boots the routes with test services). Cover:

1. `POST /provider/discover` against a `Bun.serve` stub returning `{data:[{id:"m1"}]}` → `{models:[{id:"m1",name:"m1"}]}`; against a 404 stub → `ProviderDiscoveryError` with `kind: "Unsupported"`.
2. `PUT /provider/custom/mine` with a temp `Global.Path.config` (check how existing tests override the global dir — there is likely a test env var or layer; if the harness makes this awkward, cover `CustomProvider.save` via Task 5 tests and test only the 400-branches + auth.set call here) → subsequent `GET /provider/custom` lists it without any apiKey field.
3. `POST /provider/refresh` returns `{added: [...]}` (may be empty in the test env).

Run: `cd packages/opencode && bun test test/server/httpapi-provider-discovery.test.ts`
Expected: pass.

- [ ] **Step 4: Regenerate the SDK**

Per repo `AGENTS.md`: `cd packages/client && bun run generate`
Expected: `src/generated*` / `packages/sdk/js/src/v2/gen/types.gen.ts` + `openapi.json` pick up the four new endpoints. If `script/generate.ts` churns unrelated files via repo-wide prettier (it did previously), restore unrelated files from HEAD before committing (`git show HEAD:path > path`).

- [ ] **Step 5: typecheck + commit**

Run: `cd packages/opencode && bun typecheck && cd ../client && bun typecheck 2>/dev/null || true`
Expected: opencode clean.

```bash
git add packages/opencode/src/server packages/opencode/test/server packages/client/src/generated packages/client/src/generated-effect packages/sdk
git commit -m "feat(opencode): add provider discovery/custom/refresh endpoints"
```

---

### Task 7: CLI manual trigger

**Files:**

- Modify: `packages/opencode/src/cli/cmd/models.ts:25-62`

- [ ] **Step 1: Extend `--refresh`**

In `models.ts` handler, replace the `if (args.refresh)` block (lines 29-32) with:

```ts
if (args.refresh) {
  yield * ModelsDev.Service.use((s) => s.refresh(true))
  const { Discover } = yield * Effect.promise(() => import("@/provider/discover"))
  const { Global } = yield * Effect.promise(() => import("@opencode-ai/core/global"))
  const discoverCache = yield * Discover.makeCache(Global.Path.data)
  if (args.provider) {
    yield * discoverCache.expire(args.provider)
  } else {
    const data = yield * discoverCache.read()
    for (const id of Object.keys(data)) yield * discoverCache.expire(id)
  }
  // Best-effort: if a server is running, trigger its live refresh so a
  // running TUI picks up new models without restart.
  const serverJson =
    yield *
    Effect.promise(() =>
      Bun.file(`${Global.Path.data}/server.json`)
        .json()
        .catch(() => undefined),
    )
  if (serverJson?.url && serverJson?.password) {
    const result =
      yield *
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${serverJson.url}/provider/refresh`, {
            method: "POST",
            headers: { authorization: `Basic ${Buffer.from(`:${serverJson.password}`).toString("base64")}` },
            signal: AbortSignal.timeout(5000),
          })
          return response.ok ? ((await response.json()) as { added: string[] }) : undefined
        },
        catch: () => undefined,
      }).pipe(Effect.orElseSucceed(() => undefined))
    if (result?.added?.length) {
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Live server picked up ${result.added.length} new model(s): ${result.added.join(", ")}` +
          UI.Style.TEXT_NORMAL,
      )
    }
  }
  UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
}
```

Check the actual auth header format the server expects — read `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts` first and mirror exactly what it wants (the `server.json` password scheme; if it is a bearer or a different basic-user format, use that). Also confirm `server.json` lives at `Global.Path.data` — the surgery data dir shows it does.

The existing `[provider]` positional then scopes the discovery-cache expiry; the final listing already prints the fresh state because the CLI builds its own Provider state after expiring.

- [ ] **Step 2: Manual verification (no unit test for CLI glue)**

Run against a stub: start the built dev server (see Task 9 smoke), run `bun run cmd models --refresh` from `packages/opencode`... Actually simplest: `cd packages/opencode && bun src/index.ts models --refresh` with the surgery env. Expected output contains "Models cache refreshed" and, with a live server, the "Live server picked up" line when new models exist.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/cli/cmd/models.ts
git commit -m "feat(opencode): trigger discovery refresh from models --refresh"
```

---

### Task 8: TUI — custom provider dialog

**Files:**

- Create: `packages/tui/src/component/dialog-custom-provider.tsx`
- Modify: `packages/tui/src/component/dialog-provider.tsx` (add entry point)

Read these first and mirror their patterns: `dialog-provider.tsx` (DialogPrompt chaining, `sdk.client.auth.set`, `dialog.replace`), `dialog-select.tsx` props, `useToast`. SDK client calls come from the regenerated SDK (Task 6 step 4): `sdk.client.provider.discover`, `sdk.client.provider.custom.list`, `sdk.client.provider.custom.save` — check the generated client method names in `packages/client/src/generated*` and use the real ones.

- [ ] **Step 1: Implement the dialog**

Flow (chained `DialogPrompt`s like `PromptsMethod` in `dialog-provider.tsx:349-397`):

1. If editing: entry select lists `新建自定义 provider…` plus each existing custom provider (`GET /provider/custom`) as `编辑 {id}`.
2. Prompt sequence: provider ID (locked when editing — show as text, skip prompt) → display name (optional, empty allowed) → baseURL → apiKey (placeholder shows `留空保持不变` when editing; `type="password"` if DialogPrompt supports it — check the component, otherwise plain input).
3. `DialogSelect`: `自动拉取模型列表` vs `手动输入模型 ID`.
   - Auto: call `sdk.client.provider.discover({baseURL, apiKey})`. On success show a confirm select (`添加全部 N 个模型` / `改为手动输入`). On error: `toast.show({variant: "error", message})` then fall to the manual prompt.
   - Manual: one `DialogPrompt` accepting comma- or space-separated ids; split on `/[,\s]+/`, filter empty.
4. Save: `sdk.client.provider.custom.save({providerID: id, name, baseURL, models, discover_models: autoSucceeded, apiKey: apiKey || undefined})`. On error toast; on success `toast.show({message: "已保存,模型立即可用", variant: "info"})`, then `await sync.bootstrap()` and `dialog.replace(() => <DialogModel providerID={id} />)` (same pattern as `ApiMethod` at dialog-provider.tsx:331-346, but WITHOUT `instance.dispose()` — the server already refreshed provider state surgically in the PUT handler).

- [ ] **Step 2: Wire the entry point**

In `dialog-provider.tsx` `createDialogProviderOptions`, append a synthetic option after the mapped providers (inside the `createMemo`, after the `pipe(...)` chain, e.g. `[...mapped, customEntry]`):

```ts
{
  title: "自定义 provider…",
  value: "__custom__",
  description: "baseURL + apiKey,可拉取或手动输入模型",
  category: "Configured providers",
  async onSelect() {
    dialog.replace(() => <DialogCustomProvider />)
  },
}
```

(Add `type: "provider", providerID: "__custom__"` fields to satisfy the option type, and import the new dialog component.)

- [ ] **Step 3: typecheck + commit**

Run: `cd packages/tui && bun typecheck`
Expected: clean.

```bash
git add packages/tui/src/component/dialog-custom-provider.tsx packages/tui/src/component/dialog-provider.tsx
git commit -m "feat(tui): add custom provider dialog with pull-or-manual model entry"
```

---

### Task 9: TUI — model picker refresh

**Files:**

- Modify: `packages/tui/src/component/dialog-model.tsx`

- [ ] **Step 1: Refetch provider list when the dialog opens and on ctrl+r**

Read `dialog-model.tsx` first. The picker reads `sync.data.provider` / `provider_next` populated at bootstrap (sync.tsx:524-525). Add:

1. `onMount(() => { void sync.bootstrap() })` — wait: check what `sync.bootstrap` refetches; if it is heavy, instead add a targeted refetch. Look at sync.tsx for an existing narrower fetcher (e.g. how `provider_next` is loaded) and call that. Use whichever the codebase already exposes; do not invent a new store slice.
2. A keybind via `useBindings` (pattern in `dialog-provider.tsx:185-201`): `ctrl+r` → call the new SDK `provider.refresh` endpoint, then the same refetch as above, then `toast.show` with `新增 N 个模型: …` or `模型列表已是最新`.

- [ ] **Step 2: typecheck + commit**

Run: `cd packages/tui && bun typecheck`
Expected: clean.

```bash
git add packages/tui/src/component/dialog-model.tsx
git commit -m "feat(tui): refresh model list in picker on open and via ctrl+r"
```

---

### Task 10: Acceptance gates

- [ ] **Step 1: Full typecheck + targeted tests**

```bash
cd packages/core && bun typecheck
cd packages/opencode && bun typecheck && bun test test/provider/ test/config/custom-provider.test.ts test/server/httpapi-provider-discovery.test.ts test/server/httpapi-sync.test.ts test/server/httpapi-instance.test.ts
cd packages/tui && bun typecheck
```

Expected: typechecks clean; all listed tests pass. Pre-existing failures to ignore (environmental, verified before this work): `workspace CRUD > create configures, persists…` (OPENCODE_AUTH_CONTENT), provider-env / ModelsDev / @parcel/watcher baseline failures in core.

- [ ] **Step 2: Compiled-binary smoke**

```bash
cd packages/opencode && OPENCODE_APP_NAME=openchinacode-surgery bun run build --single --skip-install
mkdir -p /tmp/discovery-smoke && cd /tmp/discovery-smoke
tmux new-session -d -s discovery -x 200 -y 50 'openchinacode-test'
```

1. TUI boots; open the provider dialog (`/connect` or ctrl+x p — check the actual keybind in the TUI), confirm `自定义 provider…` appears.
2. Add a custom provider with 2 manual model ids against a local stub (`Bun.serve` returning `{data:[{id:"fake-1"},{id:"fake-2"}]}` on some port, baseURL `http://127.0.0.1:<port>`), any apiKey. Save → model picker shows `fake-1`/`fake-2` WITHOUT restart.
3. Edit the same provider; switch to auto-pull; confirm the pulled list replaces the manual one.
4. `openchinacode-test models --refresh` in another terminal → prints "Models cache refreshed"; running TUI's picker reflects any newly added ids after ctrl+r (or dialog reopen).
5. Verify persistence: `cat ~/.config/openchinacode-surgery/openchinacode.jsonc` — provider entry present, comments intact; `cat ~/.local/share/openchinacode-surgery/auth.json` — key present; `cat ~/.local/share/openchinacode-surgery/discovered-models.json` — trio entries present after boot.
6. Kill tmux session: `tmux kill-session -t discovery`.

- [ ] **Step 3: Record results**

Append a `## Results` section to this plan doc with: test counts, typecheck status, smoke observations, binary version. Commit:

```bash
git add docs/superpowers/plans/2026-08-21-live-model-discovery.md
git commit -m "docs: record live model discovery acceptance results"
```

---

## Self-review notes (spec coverage)

- Spec §1 discovery service → Tasks 2-3. §2 switch/scheduling → Tasks 1, 4 (boot-time build; hourly auto-refresh dropped in favor of on-demand refresh per user requirement "手动触发" — models.dev keeps its own hourly fiber). §3 CLI trigger → Task 7. §4 endpoints → Tasks 5-6. §5 TUI → Tasks 8-9. §6 live pickup → Task 4 (`Provider.refresh`) + Task 6 handlers + Task 8 (`sync.bootstrap`). §7 errors → Tasks 2, 6, 8. §8 testing → per-task tests + Task 10.
- Dropped from spec during planning (call out to user in the final report): hourly auto-discovery fiber (manual trigger + boot + TTL cover it); multi-select checklist in TUI (all-or-nothing confirm — simpler, matches "拉列表" intent); `provider.updated` event pipeline (TUI re-fetches after its own actions; picker re-fetches on open).

---

## Results (2026-08-21, acceptance gate)

Implementation: 9 task commits (`835f644ce`…`f192c73e8`) + 3 review-fix commits (`b2d41d05d`, `ba51e4aa8`, `11868d439`) on `memory-surgery`.

### Review fixes found during acceptance (all verified by reproduction)

1. **Config double-cache defeated the no-restart promise** — `customSave` originally called only `provider.refresh()`, but provider state rebuilds read config through TWO stale layers: the per-instance Config `InstanceState` and the infinite-TTL `cachedGlobal` (`config.ts:283-291,598-607`). Reproduced: PUT succeeded but the new provider was `MISSING` from `GET /provider`. Fixed by busting `cachedGlobal` (`cfg.invalidate()`) + marking the instance for post-response disposal (`markInstanceForDisposal`, the `ConfigHttpApi.update` precedent).
2. **Edit + re-pull sent an empty key** — the TUI never returns the stored key when editing, so the discover probe 401'd. `POST /provider/discover` payload now accepts optional `apiKey` + `providerID` and falls back to auth.json. (Known limit: keys stored inline in config `options.apiKey` are not used by the probe fallback.)
3. **Edit wiped hand-tuned model metadata** — `CustomProvider.save` replaced the whole models map with `{name}` stubs; the user's real `volcengine-agent-plan` entry has tuned `reasoning`/`limit`/`variants` per model. Now merges: existing per-model config is preserved, only genuinely new ids get stubs (test asserts it).
4. **ctrl+r closed the picker** — full `sync.bootstrap()` runs `project.sync()`, whose side effects tear down open dialogs. Added narrow `sync.refreshProviders()` (only `config.providers` + `provider.list`) used by both the picker's on-mount refetch and ctrl+r.

### Verification numbers (reproduced by reviewer)

- `packages/core`: typecheck clean. `packages/tui`: typecheck clean. `packages/sdk`: typecheck clean.
- `packages/opencode`: typecheck clean; `test/server/httpapi-provider-discovery.test.ts` 5/5, `test/provider/discover.test.ts` 10/10, `test/provider/discover-build.test.ts` 3/3, `test/config/custom-provider.test.ts` 3/3. Combined provider/config/server suite: 394 pass / 54 fail — the 54 are the pre-existing environmental group (Bedrock/digitalocean/OpenAI absent from the fork's filtered catalog; verified as a strict subset of the HEAD baseline, zero new failures).
- Compiled binary `0.0.0-memory-surgery-202608211146`, smoke against the real surgery data dir + a local OpenAI-compatible stub (`Bun.serve`, port 8799):
  - `POST /provider/discover` probes the stub → `{models:[smoke-model-1, smoke-model-2]}`; providerID-only probe correctly falls back to auth.json key.
  - `PUT /provider/custom/smoke-test` (manual id) → provider appears in `GET /provider` connected list without restart; edit (pulled ids, no apiKey in payload) → models swap to `smoke-model-1/2`, again no restart.
  - TUI: model picker shows the new provider's models; ctrl+r refreshes in place with the dialog staying open; Connect dialog lists `自定义 provider…` entry.
  - Built-in trio live discovery at state build wrote `discovered-models.json`: zhipuai-pay2go 9 models, moonshotai-cn 12, deepseek 3. CLI `openchinacode-test models` lists live-discovered ids (e.g. `zhipuai-pay2go/glm-4.7`, `glm-4.7-flash`) that models.dev had not catalogued.
  - Persistence: jsonc entry written with comments and the hand-tuned `volcengine-agent-plan` models untouched; apiKey in auth.json only; `GET /provider/custom` never exposes keys.
  - `POST /provider/refresh` → `{added: []}` (correct: boot discovery had already merged everything).
- Smoke pollution fully cleaned up afterwards (smoke-test removed from jsonc + auth.json, stub killed, tmux session killed, discovery cache deleted).

### Deviations from this plan (accepted)

- `Discover.makeCache` built in the outer Provider layer, not inside `InstanceState.make` (the `R = never` constraint requires it; the cache is a global file anyway).
- CLI live-server call uses the real `ServerRegistry.read` + `ServerAuth.headers` (plan's inline Basic-auth guess had the wrong username) and passes `?directory=<cwd>`.
- No `packages/client` in this fork — SDK regen via root `bun script/generate.ts`; 46 files of unrelated prettier churn restored from HEAD.
- Picker on-mount refetch + ctrl+r use `sync.refreshProviders()` (added in review fix 4) instead of the plan's `sync.bootstrap()`.
- Spec deviations recorded in the plan header remain: no hourly fiber, no multi-select checklist, no `provider.updated` event.
