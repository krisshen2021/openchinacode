import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { ProviderV2 } from "@opencode-ai/core/provider"

const root = "/provider"

const ProviderAuthErrorName = Schema.Union([
  Schema.Literal("BadRequest"),
  Schema.Literal("ProviderAuthOauthMissing"),
  Schema.Literal("ProviderAuthOauthCodeMissing"),
  Schema.Literal("ProviderAuthOauthCallbackFailed"),
  Schema.Literal("ProviderAuthValidationFailed"),
])
export class ProviderAuthApiError extends Schema.ErrorClass<ProviderAuthApiError>("ProviderAuthError")(
  {
    name: ProviderAuthErrorName,
    data: Schema.Struct({
      providerID: Schema.optional(ProviderV2.ID),
      field: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.String),
    }),
  },
  { httpApiStatus: 400 },
) {}

export class ProviderDiscoveryApiError extends Schema.ErrorClass<ProviderDiscoveryApiError>("ProviderDiscoveryError")(
  {
    kind: Schema.Literals(["Unsupported", "Auth", "Network", "BadRequest"]),
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const ProviderApi = HttpApi.make("provider")
  .add(
    HttpApiGroup.make("provider")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Provider.ListResult, "List of providers"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.list",
            summary: "List providers",
            description: "Get a list of all available AI providers, including both available and connected ones.",
          }),
        ),
        HttpApiEndpoint.get("auth", `${root}/auth`, {
          query: WorkspaceRoutingQuery,
          success: described(ProviderAuth.Methods, "Provider auth methods"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.auth",
            summary: "Get provider auth methods",
            description: "Retrieve available authentication methods for all AI providers.",
          }),
        ),
        HttpApiEndpoint.post("authorize", `${root}/:providerID/oauth/authorize`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.AuthorizeInput,
          success: described(Schema.UndefinedOr(ProviderAuth.Authorization), "Authorization URL and method"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.authorize",
            summary: "Start OAuth authorization",
            description: "Start the OAuth authorization flow for a provider.",
          }),
        ),
        HttpApiEndpoint.post("callback", `${root}/:providerID/oauth/callback`, {
          params: { providerID: ProviderV2.ID },
          query: WorkspaceRoutingQuery,
          payload: ProviderAuth.CallbackInput,
          success: described(Schema.Boolean, "OAuth callback processed successfully"),
          error: ProviderAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.oauth.callback",
            summary: "Handle OAuth callback",
            description: "Handle the OAuth callback from a provider after user authorization.",
          }),
        ),
        HttpApiEndpoint.post("discover", `${root}/discover`, {
          query: WorkspaceRoutingQuery,
          payload: Schema.Struct({ baseURL: Schema.String, apiKey: Schema.String }),
          success: described(
            Schema.Struct({ models: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })) }),
            "Discovered models",
          ),
          error: ProviderDiscoveryApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.discover",
            summary: "Probe an OpenAI-compatible endpoint for its model list",
          }),
        ),
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
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.custom.list",
            summary: "List config-declared custom providers (never includes apiKey)",
          }),
        ),
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
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.custom.save",
            summary: "Create or update a custom provider in the global config",
          }),
        ),
        HttpApiEndpoint.post("refresh", `${root}/refresh`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Struct({ added: Schema.Array(Schema.String) }), "Newly discovered models"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "provider.refresh",
            summary: "Refresh models.dev and discovered models, rebuilding provider state",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "provider",
          description: "Experimental HttpApi provider routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
