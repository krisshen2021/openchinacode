import { Agent } from "@opencode-ai/schema/agent"
import { Command } from "@opencode-ai/schema/command"
import { FileSystem } from "@opencode-ai/schema/filesystem"
import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { ProjectCopy } from "@opencode-ai/schema/project-copy"
import { Provider } from "@opencode-ai/schema/provider"
import { Reference } from "@opencode-ai/schema/reference"
import { PositiveInt } from "@opencode-ai/schema/schema"
import { Skill } from "@opencode-ai/schema/skill"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { LocationMiddleware } from "../middleware/location"

// Ported @opencode-ai/server /api/* surface. Paths, wire shapes, and OpenAPI
// identifiers are byte-compatible with the removed protocol groups so the
// generated v2 SDK keeps working unchanged.

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

const LocationGroup = HttpApiGroup.make("server.location")
  .add(
    HttpApiEndpoint.get("location.get", "/api/location", {
      query: LocationQuery,
      success: Location.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.location.get",
          summary: "Get location",
          description: "Resolve the requested location or the server default location.",
        }),
      ),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const AgentGroup = HttpApiGroup.make("server.agent")
  .add(
    HttpApiEndpoint.get("agent.list", "/api/agent", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Agent.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.agent.list",
          summary: "List agents",
          description: "Retrieve currently registered agents.",
        }),
      ),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const CommandGroup = HttpApiGroup.make("server.command")
  .add(
    HttpApiEndpoint.get("command.list", "/api/command", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Command.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.command.list",
          summary: "List commands",
          description: "Retrieve currently registered commands.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "commands",
      description: "Experimental command routes.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const IntegrationGroup = HttpApiGroup.make("server.integration")
  .add(
    HttpApiEndpoint.get("integration.list", "/api/integration", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Integration.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.list",
          summary: "List integrations",
          description: "Retrieve available integrations and their authentication methods.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "integrations", description: "Integration discovery routes." }))
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.list",
          summary: "List models",
          description: "Retrieve available models ordered by release date.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "models",
      description: "Experimental model routes.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Provider.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "providers",
      description: "Experimental provider routes.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const ReferenceGroup = HttpApiGroup.make("server.reference")
  .add(
    HttpApiEndpoint.get("reference.list", "/api/reference", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Reference.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.reference.list",
          summary: "List references",
          description: "List references available in the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "reference",
      description: "Location-scoped project references.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const SkillGroup = HttpApiGroup.make("server.skill")
  .add(
    HttpApiEndpoint.get("skill.list", "/api/skill", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Skill.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.skill.list",
          summary: "List skills",
          description: "Retrieve currently registered skills.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skills",
      description: "Experimental skill routes.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const FindQuery = Schema.Struct({
  ...LocationQuery.fields,
  query: FileSystem.FindInput.fields.query,
  type: FileSystem.FindInput.fields.type,
  limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
})

const FileSystemGroup = HttpApiGroup.make("server.fs")
  .add(
    HttpApiEndpoint.get("fs.find", "/api/fs/find", {
      query: FindQuery,
      success: Location.response(Schema.Array(FileSystem.Entry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.fs.find",
          summary: "Find files",
          description: "Find recursively ranked filesystem entries relative to the requested location.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "filesystem",
      description: "Experimental location-scoped filesystem routes.",
    }),
  )
  .middleware(LocationMiddleware)
  .middleware(Authorization)

const projectCopyRoot = "/experimental/project/:projectID/copy"

export class ProjectCopyError extends Schema.ErrorClass<ProjectCopyError>("ProjectCopyError")(
  {
    name: Schema.Literal("ProjectCopyError"),
    data: Schema.Struct({
      message: Schema.String,
      forceRequired: Schema.optional(Schema.Boolean),
    }),
  },
  { httpApiStatus: 400 },
) {}

const ProjectCopyCreatePayload = Schema.Struct(
  Struct.omit(ProjectCopy.CreateInput.fields, ["projectID", "sourceDirectory"]),
)
const ProjectCopyRemovePayload = Schema.Struct(Struct.omit(ProjectCopy.RemoveInput.fields, ["projectID"]))

const ProjectCopyGroup = HttpApiGroup.make("server.projectCopy")
  .add(
    HttpApiEndpoint.post("projectCopy.create", projectCopyRoot, {
      params: { projectID: Project.ID },
      query: LocationQuery,
      payload: ProjectCopyCreatePayload,
      success: ProjectCopy.Copy,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.create" })),
  )
  .add(
    HttpApiEndpoint.delete("projectCopy.remove", projectCopyRoot, {
      params: { projectID: Project.ID },
      query: LocationQuery,
      payload: ProjectCopyRemovePayload,
      success: HttpApiSchema.NoContent,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.remove" })),
  )
  .add(
    HttpApiEndpoint.post("projectCopy.refresh", `${projectCopyRoot}/refresh`, {
      params: { projectID: Project.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: ProjectCopyError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(OpenApi.annotations({ identifier: "v2.projectCopy.refresh" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "projectCopy", description: "Project copy management routes." }))
  .middleware(LocationMiddleware)
  .middleware(Authorization)

export const V2Api = HttpApi.make("v2")
  .add(LocationGroup)
  .add(AgentGroup)
  .add(CommandGroup)
  .add(IntegrationGroup)
  .add(ModelGroup)
  .add(ProviderGroup)
  .add(ReferenceGroup)
  .add(SkillGroup)
  .add(FileSystemGroup)
  .add(ProjectCopyGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
