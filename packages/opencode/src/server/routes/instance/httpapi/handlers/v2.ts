import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { CommandV2 } from "@opencode-ai/core/command"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { Git } from "@opencode-ai/core/git"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { Reference } from "@opencode-ai/core/reference"
import { SkillV2 } from "@opencode-ai/core/skill"
import { Effect, Layer } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProjectCopyError } from "../groups/v2"

// Handlers for the ported /api/* surface (groups/v2.ts). Location scoping comes
// from LocationMiddleware, which provides the request's location services.

function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

const locationHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.location", (handlers) =>
  handlers.handle(
    "location.get",
    Effect.fn(function* () {
      const location = yield* Location.Service
      return new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      })
    }),
  ),
)

const agentHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.agent", (handlers) =>
  handlers.handle("agent.list", () => response(AgentV2.Service.use((agent) => agent.all()))),
)

const commandHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.command", (handlers) =>
  handlers.handle("command.list", () => response(CommandV2.Service.use((command) => command.list()))),
)

const integrationHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.integration", (handlers) =>
  handlers.handle("integration.list", () => response(Integration.Service.use((service) => service.list()))),
)

const modelHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.model", (handlers) =>
  handlers.handle("model.list", () => response(Catalog.Service.use((catalog) => catalog.model.available()))),
)

const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.provider", (handlers) =>
  handlers.handle("provider.list", () => response(Catalog.Service.use((catalog) => catalog.provider.available()))),
)

const referenceHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.reference", (handlers) =>
  handlers.handle("reference.list", () => response(Reference.Service.use((reference) => reference.list()))),
)

const skillHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.skill", (handlers) =>
  handlers.handle("skill.list", () => response(SkillV2.Service.use((skill) => skill.list()))),
)

const fsHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.fs", (handlers) =>
  handlers.handle("fs.find", (ctx) => response(FileSystem.Service.use((fs) => fs.find(ctx.query)))),
)

const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "server.projectCopy", (handlers) =>
  handlers
    .handle("projectCopy.create", (ctx) =>
      Effect.gen(function* () {
        const copies = yield* ProjectCopy.Service
        const location = yield* Location.Service
        return yield* badRequest(
          copies.create({
            ...ctx.payload,
            projectID: ctx.params.projectID,
            sourceDirectory: location.project.directory,
          }),
        )
      }),
    )
    .handle("projectCopy.remove", (ctx) =>
      ProjectCopy.Service.use((copies) =>
        badRequest(copies.remove({ ...ctx.payload, projectID: ctx.params.projectID })).pipe(
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      ),
    )
    .handle("projectCopy.refresh", (ctx) =>
      ProjectCopy.Service.use((copies) =>
        badRequest(copies.refresh({ projectID: ctx.params.projectID })).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      ),
    ),
)

function badRequest<A, R>(effect: Effect.Effect<A, ProjectCopy.Error, R>) {
  return effect.pipe(
    Effect.mapError(
      (error) =>
        new ProjectCopyError({
          name: "ProjectCopyError",
          data: {
            message: message(error),
            forceRequired: error instanceof Git.WorktreeError ? error.forceRequired : undefined,
          },
        }),
    ),
  )
}

function message(error: ProjectCopy.Error) {
  if (error instanceof ProjectCopy.SourceDirectoryNotFoundError)
    return `Project copy source not found: ${error.directory}`
  if (error instanceof ProjectCopy.DestinationExistsError)
    return `Project copy destination already exists: ${error.directory}`
  if (error instanceof ProjectCopy.DirectoryUnavailableError)
    return `Project copy directory unavailable: ${error.directory}`
  if (error instanceof ProjectCopy.InvalidDirectoryError) return `Invalid project copy directory: ${error.directory}`
  if (error instanceof ProjectCopy.StrategyUnavailableError)
    return `Project copy strategy unavailable: ${error.strategy}`
  return error.message
}

export const v2Handlers = Layer.mergeAll(
  locationHandlers,
  agentHandlers,
  commandHandlers,
  integrationHandlers,
  modelHandlers,
  providerHandlers,
  referenceHandlers,
  skillHandlers,
  fsHandlers,
  projectCopyHandlers,
)
