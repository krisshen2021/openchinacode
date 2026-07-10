export * as ConfigIntegrationTest from "./integration-test"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export const Service = Schema.Struct({
  command: Schema.String.annotate({
    description: "Command used to start a long-running frontend/backend service for integration testing.",
  }),
  cwd: Schema.optional(Schema.String).annotate({
    description: "Working directory for the service command. Relative paths resolve from the project root.",
  }),
  host: Schema.optional(Schema.String).annotate({
    description: "Host to probe when waiting for the configured port. Defaults to 127.0.0.1.",
  }),
  port: Schema.optional(PositiveInt).annotate({
    description: "TCP port that must accept connections before browser tests start.",
  }),
  ready_text: Schema.optional(Schema.String).annotate({
    description: "Log substring that indicates the service is ready.",
  }),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Extra environment variables for the service command.",
  }),
  wait_timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Maximum startup wait time for this service in milliseconds.",
  }),
}).annotate({ identifier: "IntegrationTestService" })
export type Service = Schema.Schema.Type<typeof Service>

export const PlaywrightMcp = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the generated Playwright MCP config should be enabled.",
  }),
  headless: Schema.optional(Schema.Boolean).annotate({
    description: "Run Playwright MCP in headless mode. Defaults to true for OpenChinaCode.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "MCP request timeout in milliseconds.",
  }),
}).annotate({ identifier: "IntegrationTestPlaywrightMcp" })
export type PlaywrightMcp = Schema.Schema.Type<typeof PlaywrightMcp>

export const Info = Schema.Struct({
  base_url: Schema.optional(Schema.String).annotate({
    description: "Base URL used by Playwright integration tests, for example http://127.0.0.1:5173.",
  }),
  health_url: Schema.optional(Schema.String).annotate({
    description: "Optional backend health URL checked before browser tests run.",
  }),
  frontend: Schema.optional(Service).annotate({
    description: "Frontend dev server or preview server managed during integration tests.",
  }),
  backend: Schema.optional(Service).annotate({
    description: "Backend API server managed during integration tests.",
  }),
  playwright_config: Schema.optional(Schema.String).annotate({
    description: "Path to the Playwright config used by openchinacode test run.",
  }),
  report_dir: Schema.optional(Schema.String).annotate({
    description: "Directory where OpenChinaCode integration reports are written.",
  }),
  mcp: Schema.optional(PlaywrightMcp).annotate({
    description: "Playwright MCP template options for openchinacode test mcp.",
  }),
}).annotate({ identifier: "IntegrationTestConfig" })
export type Info = Schema.Schema.Type<typeof Info>
