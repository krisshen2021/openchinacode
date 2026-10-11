import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context, PubSub } from "effect"

export interface Interface {
  readonly signal: (sessionID: SessionID) => Effect.Effect<void>
  readonly watch: (sessionID: SessionID, onSteer: () => void) => Effect.Effect<never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSteer") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("SessionSteer.state")(() => PubSub.unbounded<SessionID>()),
    )

    const signal = Effect.fn("SessionSteer.signal")(function* (sessionID: SessionID) {
      const bus = yield* InstanceState.get(state)
      yield* PubSub.publish(bus, sessionID)
    })

    const watch = (sessionID: SessionID, onSteer: () => void): Effect.Effect<never> =>
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* InstanceState.get(state)
          const subscription = yield* PubSub.subscribe(bus)
          return yield* Effect.forever(
            Effect.flatMap(PubSub.take(subscription), (id) =>
              id === sessionID ? Effect.sync(onSteer) : Effect.void,
            ),
          )
        }),
      )

    return Service.of({ signal, watch })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [] })

export * as SessionSteer from "./steer"
