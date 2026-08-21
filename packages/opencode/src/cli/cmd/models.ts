import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import type { ProviderV2 } from "@opencode-ai/core/provider"

export const ModelsCommand = effectCmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.models")(function* (args) {
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
    const { ModelsDev } = yield* Effect.promise(() => import("@opencode-ai/core/models-dev"))
    const { ProviderV2 } = yield* Effect.promise(() => import("@opencode-ai/core/provider"))
    if (args.refresh) {
      const { Discover } = yield* Effect.promise(() => import("@/provider/discover"))
      const { Global } = yield* Effect.promise(() => import("@opencode-ai/core/global"))
      const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
      const { ServerRegistry } = yield* Effect.promise(() => import("@/server/registry"))
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      const discoverCache = yield* Discover.makeCache(Global.Path.data)
      if (args.provider) {
        yield* discoverCache.expire(args.provider)
      } else {
        const data = yield* discoverCache.read()
        for (const id of Object.keys(data)) yield* discoverCache.expire(id)
      }
      // Best-effort: if a server is running, trigger its live refresh so a
      // running TUI picks up new models without restart.
      const entry = yield* Effect.promise(() => ServerRegistry.read(Global.Path.data))
      if (entry?.url && entry.password) {
        const result = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(
              `${entry.url}/provider/refresh?directory=${encodeURIComponent(process.cwd())}`,
              {
                method: "POST",
                headers: ServerAuth.headers({ password: entry.password }),
                signal: AbortSignal.timeout(5000),
              },
            )
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

    const provider = yield* Provider.Service
    const providers = yield* provider.list()

    const print = (providerID: ProviderV2.ID, verbose?: boolean) => {
      const p = providers[providerID]
      const sorted = Provider.sort(Object.values(p.models))
      for (const model of sorted) {
        process.stdout.write(`${providerID}/${model.id}`)
        process.stdout.write(EOL)
        if (verbose) {
          process.stdout.write(JSON.stringify(model, null, 2))
          process.stdout.write(EOL)
        }
      }
    }

    if (args.provider) {
      const providerID = ProviderV2.ID.make(args.provider)
      if (!providers[providerID]) return yield* fail(`Provider not found: ${args.provider}`)
      print(providerID, args.verbose)
      return
    }

    const ids = Object.keys(providers).sort((a, b) => {
      return a.localeCompare(b)
    })

    for (const providerID of ids) print(ProviderV2.ID.make(providerID), args.verbose)
  }),
})
