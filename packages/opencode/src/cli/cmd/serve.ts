import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const { Flag } = yield* Effect.promise(() => import("@opencode-ai/core/flag/flag"))
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      console.log("Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

    if (!process.env.OPENCODE_SKIP_REGISTRY) {
      const { Global } = yield* Effect.promise(() => import("@opencode-ai/core/global"))
      const { InstallationVersion } = yield* Effect.promise(() => import("@opencode-ai/core/installation/version"))
      const { ServerRegistry } = yield* Effect.promise(() => import("../../server/registry"))
      yield* Effect.promise(() =>
        ServerRegistry.write(Global.Path.data, {
          pid: process.pid,
          url: `http://${server.hostname}:${server.port}`,
          version: InstallationVersion,
          ...(Flag.OPENCODE_SERVER_PASSWORD ? { password: Flag.OPENCODE_SERVER_PASSWORD } : {}),
          startedAt: Date.now(),
        }),
      )
      // Signal handlers (not process.on("exit")) so the async removal completes.
      // Ownership guard: only remove the entry if it still belongs to this process —
      // a slow shutdown may outlive the fresh server that replaced this one.
      const shutdown = () => ServerRegistry.remove(Global.Path.data, process.pid).finally(() => process.exit(0))
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    }

    yield* Effect.never
  }),
})
