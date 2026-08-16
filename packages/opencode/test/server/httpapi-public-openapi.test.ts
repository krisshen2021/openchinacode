import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"

type Method = "get" | "post" | "put" | "delete" | "patch"
type OpenApiSchema = {
  readonly $ref?: string
  readonly anyOf?: ReadonlyArray<OpenApiSchema>
  readonly type?: string
  readonly enum?: readonly unknown[]
  readonly properties?: Record<string, OpenApiSchema>
  readonly required?: readonly string[]
  readonly contentSchema?: OpenApiSchema
  readonly contentMediaType?: string
}
type OpenApiResponse = {
  readonly description?: string
  readonly content?: Record<string, { readonly schema?: OpenApiSchema }>
}
type OpenApiOperation = {
  readonly parameters?: ReadonlyArray<{
    readonly name: string
    readonly in: string
    readonly required?: boolean
    readonly schema?: { readonly type?: string }
  }>
  readonly responses?: Record<string, OpenApiResponse>
  readonly requestBody?: { readonly required?: boolean }
  readonly security?: unknown
}
type OpenApiPathItem = Partial<Record<Method, OpenApiOperation>>
type OpenApiSpec = {
  readonly paths: Record<string, OpenApiPathItem>
  readonly components: { readonly schemas: Record<string, OpenApiSchema> }
}

const methods = ["get", "post", "put", "delete", "patch"] as const

const allowedV2BuiltInEndpointErrors: string[] = []

function v2Operations(spec: OpenApiSpec) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    path.startsWith("/api/")
      ? methods.flatMap((method) => {
          const operation = item[method]
          return operation ? [{ method, path, operation }] : []
        })
      : [],
  )
}

function responseRef(response: OpenApiResponse | undefined) {
  return response?.content?.["application/json"]?.schema?.$ref
}

function componentName(ref: string) {
  return ref.replace("#/components/schemas/", "")
}

function isBuiltInEndpointError(name: string) {
  return name.startsWith("EffectHttpApiError") || name.startsWith("effect_HttpApiError_")
}

describe("PublicApi OpenAPI v2 errors", () => {
  test("includes plugin-facing core schemas", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining([
        "CredentialValue",
        "IntegrationInputs",
        "IntegrationMethod",
        "IntegrationRef",
        "SkillV2Source",
      ]),
    )
  })

  test("documents nested legacy global sync events", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const schema = spec.components.schemas.SyncEventSessionCreated

    expect(schema?.required).toEqual(["type", "id", "syncEvent"])
    expect(schema?.properties?.type?.enum).toEqual(["sync"])
    expect(schema?.properties?.syncEvent).toMatchObject({
      required: ["type", "id", "seq", "aggregateID", "data"],
      properties: {
        type: { enum: ["session.created.1"] },
        id: { type: "string" },
        seq: { type: "number" },
        aggregateID: { type: "string" },
      },
    })
  })

  test("documents exactly the ported location-scoped /api routes", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const paths = Object.keys(spec.paths)
      .filter((path) => path === "/api" || path.startsWith("/api/"))
      .sort()

    expect(paths).toEqual([
      "/api/agent",
      "/api/command",
      "/api/fs/find",
      "/api/integration",
      "/api/location",
      "/api/model",
      "/api/provider",
      "/api/reference",
      "/api/skill",
    ])
    for (const path of paths) {
      const names = (spec.paths[path]?.get?.parameters ?? []).map((parameter) => parameter.name)
      expect(names, path).toContain("location")
    }
  })

  test("treats /api auth metadata like legacy routes", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of v2Operations(spec)) {
      expect(route.operation.responses?.["401"], `${route.method.toUpperCase()} ${route.path}`).toBeUndefined()
      expect(route.operation.security, `${route.method.toUpperCase()} ${route.path}`).toBeUndefined()
    }
  })

  test("documents references separately from filesystem routes", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(spec.paths["/api/fs/find"]?.get?.parameters).not.toContainEqual(
      expect.objectContaining({ name: "reference" }),
    )
    expect(spec.paths["/api/fs/read/*"]).toBeUndefined()
    expect(spec.paths["/api/fs/list"]).toBeUndefined()
    expect(spec.paths["/api/reference"]?.get).toBeDefined()
  })

  test("documents integration discovery routes only", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(spec.paths["/api/integration"]?.get).toBeDefined()
    for (const path of [
      "/api/integration/{integrationID}",
      "/api/integration/{integrationID}/connect/key",
      "/api/integration/{integrationID}/connect/oauth",
      "/api/integration/attempt/{attemptID}",
      "/api/integration/attempt/{attemptID}/complete",
      "/api/credential/{credentialID}",
    ]) {
      expect(spec.paths[path], path).toBeUndefined()
    }
  })

  test("rewrites /api endpoint errors to legacy error components", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const refs = v2Operations(spec).flatMap((route) => {
      const response = route.operation.responses?.["400"]
      const ref = responseRef(response)
      return ref ? [`${route.method.toUpperCase()} ${route.path} 400 ${componentName(ref)}`] : []
    })

    expect(refs.length).toBeGreaterThan(0)
    for (const entry of refs) {
      expect(entry).toMatch(/ BadRequestError$/)
    }
  })

  test("new /api endpoint errors cannot use built-in components without an explicit allowlist", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const builtInEndpointErrors = v2Operations(spec)
      .flatMap((route) =>
        Object.entries(route.operation.responses ?? {}).flatMap(([status, response]) => {
          if (status === "401") return []
          const ref = responseRef(response)
          if (!ref) return []
          const name = componentName(ref)
          return isBuiltInEndpointError(name) ? [`${route.method.toUpperCase()} ${route.path} ${status} ${name}`] : []
        }),
      )
      .sort()

    expect(builtInEndpointErrors).toEqual(allowedV2BuiltInEndpointErrors)
  })

  test("documents v2 provider and model catalog errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(componentName(responseRef(spec.paths["/api/provider"]?.get?.responses?.["503"]) ?? "")).toBe(
      "ServiceUnavailableError",
    )
    expect(componentName(responseRef(spec.paths["/api/model"]?.get?.responses?.["503"]) ?? "")).toBe(
      "ServiceUnavailableError",
    )
    expect(spec.paths["/api/provider/{providerID}"]).toBeUndefined()
  })

  test("documents session busy errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/session/{sessionID}/shell"],
      ["post", "/session/{sessionID}/revert"],
      ["post", "/session/{sessionID}/unrevert"],
      ["delete", "/session/{sessionID}/message/{messageID}"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["409"]) ?? "")).toBe(
        "SessionBusyError",
      )
    }
  })

  test("documents permission and question not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(
      componentName(responseRef(spec.paths["/permission/{requestID}/reply"]?.post?.responses?.["404"]) ?? ""),
    ).toBe("PermissionNotFoundError")
    for (const route of [
      ["post", "/question/{requestID}/reply"],
      ["post", "/question/{requestID}/reject"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["404"]) ?? "")).toBe(
        "QuestionNotFoundError",
      )
    }
  })

  test("documents MCP server not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["post", "/mcp/{name}/auth"],
      ["post", "/mcp/{name}/auth/authenticate"],
      ["post", "/mcp/{name}/auth/callback"],
      ["delete", "/mcp/{name}/auth"],
      ["post", "/mcp/{name}/connect"],
      ["post", "/mcp/{name}/disconnect"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["404"]) ?? "")).toBe(
        "McpServerNotFoundError",
      )
    }
  })

  test("documents PTY resource and ticket errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    for (const route of [
      ["get", "/pty/{ptyID}"],
      ["put", "/pty/{ptyID}"],
      ["delete", "/pty/{ptyID}"],
      ["post", "/pty/{ptyID}/connect-token"],
    ] as const) {
      expect(componentName(responseRef(spec.paths[route[1]]?.[route[0]]?.responses?.["404"]) ?? "")).toBe(
        "PtyNotFoundError",
      )
    }
    expect(componentName(responseRef(spec.paths["/pty/{ptyID}/connect-token"]?.post?.responses?.["403"]) ?? "")).toBe(
      "PtyForbiddenError",
    )
    expect(
      spec.paths["/pty/{ptyID}/connect"]?.get?.parameters
        ?.filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name),
    ).toEqual(["directory", "workspace", "cursor", "ticket"])
  })

  test("documents project not-found errors", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec

    expect(componentName(responseRef(spec.paths["/project/{projectID}"]?.patch?.responses?.["404"]) ?? "")).toBe(
      "ProjectNotFoundError",
    )
  })
})
