import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import { applyEdits, modify, parse } from "jsonc-parser"
import type { ConfigIntegrationTest } from "@opencode-ai/core/config/integration-test"

export const DEFAULT_TEST_DIR = ".openchinacode/test-kit"
export const DEFAULT_E2E_DIR = ".openchinacode/test-kit/e2e"
export const DEFAULT_REPORT_DIR = ".openchinacode/reports"
export const DEFAULT_PLAYWRIGHT_CONFIG = ".openchinacode/test-kit/playwright.config.ts"
export const DEFAULT_MCP_NAME = "playwright"

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

export type PackageJson = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export type InitInput = {
  root: string
  force?: boolean
  baseURL?: string
  healthURL?: string
  frontendCommand?: string
  backendCommand?: string
  frontendPort?: number
  backendPort?: number
  reportDir?: string
}

export type InitResult = {
  files: string[]
  skipped: string[]
  configPath: string
  configUpdated: boolean
  packageManager: PackageManager
}

const jsonFormatting = {
  insertSpaces: true,
  tabSize: 2,
}

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(path.join(root, "bun.lockb")) || existsSync(path.join(root, "bun.lock"))) return "bun"
  if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(path.join(root, "yarn.lock"))) return "yarn"
  return "npm"
}

export async function readPackageJson(root: string): Promise<PackageJson> {
  try {
    const text = await fs.readFile(path.join(root, "package.json"), "utf8")
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed ? parsed : {}
  } catch {
    return {}
  }
}

export function packageRunCommand(pm: PackageManager, script: string) {
  return pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`
}

export function packageExecArgs(pm: PackageManager, args: string[]) {
  if (pm === "bun") return ["bunx", ...args]
  if (pm === "pnpm") return ["pnpm", "exec", ...args]
  if (pm === "yarn") return ["yarn", ...args]
  return ["npx", "-y", ...args]
}

function scriptIncludes(pkg: PackageJson, script: string, pattern: RegExp) {
  return pattern.test(pkg.scripts?.[script] ?? "")
}

export function detectFrontend(input: {
  pkg: PackageJson
  pm: PackageManager
}): ConfigIntegrationTest.Service | undefined {
  const scripts = input.pkg.scripts ?? {}
  if (!scripts.dev && !scripts.start && !scripts.serve && !scripts.preview) return
  const script = scripts.dev ? "dev" : scripts.start ? "start" : scripts.serve ? "serve" : "preview"
  const command = packageRunCommand(input.pm, script)
  const port = scriptIncludes(input.pkg, script, /\bvite\b/)
    ? 5173
    : scriptIncludes(input.pkg, script, /\bastro\b/)
      ? 4321
      : 3000
  return {
    command,
    port,
    host: "127.0.0.1",
    wait_timeout_ms: 120_000,
  }
}

export function defaultIntegrationConfig(input: {
  pkg: PackageJson
  pm: PackageManager
  baseURL?: string
  healthURL?: string
  frontendCommand?: string
  backendCommand?: string
  frontendPort?: number
  backendPort?: number
  reportDir?: string
}): ConfigIntegrationTest.Info {
  const detected = detectFrontend({ pkg: input.pkg, pm: input.pm })
  const frontend =
    input.frontendCommand || input.frontendPort
      ? {
          command: input.frontendCommand ?? detected?.command ?? packageRunCommand(input.pm, "dev"),
          host: "127.0.0.1",
          port: input.frontendPort ?? detected?.port ?? 5173,
          wait_timeout_ms: 120_000,
        }
      : detected
  const backend =
    input.backendCommand || input.backendPort
      ? {
          command: input.backendCommand ?? "python -m uvicorn app.main:app --reload",
          host: "127.0.0.1",
          port: input.backendPort ?? 8000,
          wait_timeout_ms: 120_000,
        }
      : undefined
  const baseURL =
    input.baseURL ?? (frontend?.port ? `http://${frontend.host ?? "127.0.0.1"}:${frontend.port}` : undefined)

  return {
    ...(baseURL ? { base_url: baseURL } : {}),
    ...(input.healthURL ? { health_url: input.healthURL } : {}),
    ...(frontend ? { frontend } : {}),
    ...(backend ? { backend } : {}),
    playwright_config: DEFAULT_PLAYWRIGHT_CONFIG,
    report_dir: input.reportDir ?? DEFAULT_REPORT_DIR,
    mcp: {
      enabled: false,
      headless: true,
      timeout: 30_000,
    },
  }
}

export function playwrightConfigTemplate() {
  return `import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

const root = process.cwd()
const baseURL = process.env.OPENCHINACODE_BASE_URL ?? "http://127.0.0.1:5173"
const reportDir = process.env.OPENCHINACODE_PLAYWRIGHT_REPORT_DIR ?? path.join(root, ".openchinacode/reports/playwright")

export default defineConfig({
  testDir: path.join(root, ".openchinacode/test-kit/e2e"),
  outputDir: path.join(reportDir, "results"),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["html", { outputFolder: path.join(reportDir, "html"), open: "never" }],
    ["json", { outputFile: path.join(reportDir, "results.json") }],
    ["line"],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
`
}

export function smokeSpecTemplate() {
  return `import { expect, test } from "@playwright/test"

test("backend health endpoint responds", async ({ request }) => {
  const healthURL = process.env.OPENCHINACODE_HEALTH_URL
  test.skip(!healthURL, "OPENCHINACODE_HEALTH_URL is not configured")

  const response = await request.get(healthURL!)
  expect(response.ok(), \`health check failed with status \${response.status()}\`).toBeTruthy()
})

test("homepage loads without browser errors", async ({ page }) => {
  const consoleErrors: string[] = []
  const failedResponses: string[] = []

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message)
  })
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(\`\${response.status()} \${response.url()}\`)
  })

  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.locator("body")).toBeVisible()
  await page.waitForLoadState("networkidle").catch(() => undefined)

  expect(failedResponses).toEqual([])
  expect(consoleErrors).toEqual([])
})
`
}

export function integrationGitignoreTemplate() {
  return `reports/
`
}

export function playwrightMcpConfig(input: { enabled?: boolean; headless?: boolean; timeout?: number } = {}) {
  return {
    type: "local" as const,
    command: [
      "openchinacode",
      "mcp",
      "playwright",
      input.headless === false ? "--headed" : "--headless",
      "--browser=chrome",
      "--caps=default",
    ],
    enabled: input.enabled ?? true,
    timeout: input.timeout ?? 30_000,
  }
}

function patchJsonc(text: string, keyPath: string[], value: unknown) {
  const edits = modify(text.trim() ? text : "{}", keyPath, value, {
    formattingOptions: jsonFormatting,
  })
  return applyEdits(text.trim() ? text : "{}", edits)
}

export function patchIntegrationConfigText(text: string, value: ConfigIntegrationTest.Info, force = false) {
  const parsed = parse(text || "{}") as { integration_test?: unknown } | undefined
  if (!force && parsed?.integration_test !== undefined) {
    return { text, changed: false }
  }
  return { text: patchJsonc(text, ["integration_test"], value), changed: true }
}

export function patchPlaywrightMcpText(
  text: string,
  input: { name?: string; enabled?: boolean; headless?: boolean; timeout?: number },
) {
  const name = input.name ?? DEFAULT_MCP_NAME
  return patchJsonc(text, ["mcp", name], playwrightMcpConfig(input))
}

async function writeFileOnce(
  file: string,
  content: string,
  force: boolean,
  result: Pick<InitResult, "files" | "skipped">,
) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  if (!force && existsSync(file)) {
    result.skipped.push(file)
    return
  }
  await fs.writeFile(file, content)
  result.files.push(file)
}

export async function projectConfigPath(root: string) {
  const jsonc = path.join(root, "openchinacode.jsonc")
  const json = path.join(root, "openchinacode.json")
  if (existsSync(jsonc)) return jsonc
  if (existsSync(json)) return json
  return jsonc
}

export async function initIntegrationKit(input: InitInput): Promise<InitResult> {
  const pm = detectPackageManager(input.root)
  const pkg = await readPackageJson(input.root)
  const result: InitResult = {
    files: [],
    skipped: [],
    configPath: await projectConfigPath(input.root),
    configUpdated: false,
    packageManager: pm,
  }

  await writeFileOnce(
    path.join(input.root, DEFAULT_PLAYWRIGHT_CONFIG),
    playwrightConfigTemplate(),
    !!input.force,
    result,
  )
  await writeFileOnce(
    path.join(input.root, DEFAULT_E2E_DIR, "smoke.spec.ts"),
    smokeSpecTemplate(),
    !!input.force,
    result,
  )
  await writeFileOnce(path.join(input.root, ".openchinacode/.gitignore"), integrationGitignoreTemplate(), false, result)
  await fs.mkdir(path.join(input.root, DEFAULT_REPORT_DIR), { recursive: true })

  const configText = existsSync(result.configPath) ? await fs.readFile(result.configPath, "utf8") : "{\n}\n"
  const patched = patchIntegrationConfigText(
    configText,
    defaultIntegrationConfig({
      pkg,
      pm,
      baseURL: input.baseURL,
      healthURL: input.healthURL,
      frontendCommand: input.frontendCommand,
      backendCommand: input.backendCommand,
      frontendPort: input.frontendPort,
      backendPort: input.backendPort,
      reportDir: input.reportDir,
    }),
    !!input.force,
  )
  if (patched.changed) {
    await fs.writeFile(result.configPath, patched.text)
    result.configUpdated = true
  }

  return result
}
