import { EOL } from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import net from "node:net"
import { spawn, type ChildProcess } from "node:child_process"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { killTree } from "@opencode-ai/core/shell"
import type { ConfigIntegrationTest } from "@opencode-ai/core/config/integration-test"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import {
  DEFAULT_MCP_NAME,
  DEFAULT_PLAYWRIGHT_CONFIG,
  DEFAULT_REPORT_DIR,
  detectPackageManager,
  initIntegrationKit,
  packageExecArgs,
  patchPlaywrightMcpText,
} from "@/integration-test/kit"

type ServiceInfo = {
  name: "frontend" | "backend"
  config: ConfigIntegrationTest.Service
  cwd: string
  logPath: string
  pid?: number
  started: boolean
  ready: boolean
  error?: string
}

type Check = {
  name: string
  status: "passed" | "failed" | "skipped"
  detail?: string
}

type RunReport = {
  status: "passed" | "failed"
  started_at: string
  finished_at: string
  root: string
  base_url?: string
  health_url?: string
  report_dir: string
  playwright_config: string
  services: ServiceInfo[]
  checks: Check[]
  playwright: {
    command: string
    exit_code: number | null
    output_log: string
    report_dir: string
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")

const resolvePath = (root: string, value: string) => (path.isAbsolute(value) ? value : path.join(root, value))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fileTail = async (file: string, bytes = 64 * 1024) => {
  try {
    const stat = await fs.stat(file)
    const handle = await fs.open(file, "r")
    try {
      const size = Math.min(stat.size, bytes)
      const buffer = Buffer.alloc(size)
      await handle.read(buffer, 0, size, Math.max(0, stat.size - size))
      return buffer.toString("utf8")
    } finally {
      await handle.close()
    }
  } catch {
    return ""
  }
}

const waitForPort = async (host: string, port: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port })
      socket.setTimeout(1_000)
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("timeout", () => {
        socket.destroy()
        resolve(false)
      })
      socket.once("error", () => resolve(false))
    })
    if (ok) return true
    await sleep(250)
  }
  return false
}

const waitForLogText = async (file: string, text: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await fileTail(file)).includes(text)) return true
    await sleep(250)
  }
  return false
}

const waitForHealth = async (url: string, timeoutMs: number): Promise<Check> => {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)
      if (response.ok) return { name: "health", status: "passed", detail: `${response.status} ${url}` }
      last = `${response.status} ${response.statusText}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(500)
  }
  return { name: "health", status: "failed", detail: `${url}: ${last || "timeout"}` }
}

const runProcess = async (input: {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  logPath: string
}) => {
  const handle = await fs.open(input.logPath, "a")
  return new Promise<{ code: number | null }>((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let settled = false
    const finish = async (code: number | null) => {
      if (settled) return
      settled = true
      await handle.close()
      resolve({ code })
    }
    child.stdout?.on("data", (chunk) => handle.write(chunk))
    child.stderr?.on("data", (chunk) => handle.write(chunk))
    child.once("close", (code) => {
      finish(code).catch(() => resolve({ code }))
    })
    child.once("error", (error) => {
      handle
        .write(String(error))
        .then(() => finish(1))
        .catch(() => resolve({ code: 1 }))
    })
  })
}

const startService = async (
  root: string,
  reportDir: string,
  name: "frontend" | "backend",
  config: ConfigIntegrationTest.Service,
) => {
  const cwd = resolvePath(root, config.cwd ?? ".")
  const logPath = path.join(reportDir, `${name}.log`)
  await fs.mkdir(path.dirname(logPath), { recursive: true })
  const log = await fs.open(logPath, "a")
  const child = spawn(config.command, {
    cwd,
    env: { ...process.env, ...(config.env ?? {}) },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout?.on("data", (chunk) => log.write(chunk))
  child.stderr?.on("data", (chunk) => log.write(chunk))
  child.once("close", () => log.close().catch(() => undefined))
  const info: ServiceInfo = {
    name,
    config,
    cwd,
    logPath,
    pid: child.pid,
    started: true,
    ready: false,
  }
  const timeout = config.wait_timeout_ms ?? 120_000
  const waits: Promise<boolean>[] = []
  if (config.ready_text) waits.push(waitForLogText(logPath, config.ready_text, timeout))
  if (config.port) waits.push(waitForPort(config.host ?? "127.0.0.1", config.port, timeout))
  if (waits.length === 0) waits.push(sleep(1_000).then(() => true))
  info.ready = (await Promise.all(waits)).every(Boolean)
  if (!info.ready) info.error = `service did not become ready within ${timeout}ms`
  return { child, info }
}

const stopService = async (child: ChildProcess) => {
  try {
    await killTree(child)
  } catch {
    child.kill("SIGTERM")
  }
}

const markdownReport = (report: RunReport) => {
  const services = report.services.length
    ? report.services
        .map(
          (service) =>
            `- ${service.name}: ${service.ready ? "ready" : "not ready"} pid=${service.pid ?? "n/a"} log=${service.logPath}`,
        )
        .join("\n")
    : "- no managed services started"
  const checks = report.checks.length
    ? report.checks
        .map((check) => `- ${check.name}: ${check.status}${check.detail ? ` - ${check.detail}` : ""}`)
        .join("\n")
    : "- no preflight checks"
  return [
    `# OpenChinaCode Integration Test Report`,
    "",
    `Status: ${report.status}`,
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at}`,
    `Root: ${report.root}`,
    `Base URL: ${report.base_url ?? "not configured"}`,
    `Health URL: ${report.health_url ?? "not configured"}`,
    "",
    "## Services",
    services,
    "",
    "## Checks",
    checks,
    "",
    "## Playwright",
    `Command: ${report.playwright.command}`,
    `Exit code: ${report.playwright.exit_code}`,
    `Output log: ${report.playwright.output_log}`,
    `HTML report: ${path.join(report.playwright.report_dir, "html")}`,
    "",
  ].join("\n")
}

const writeReport = async (report: RunReport) => {
  await fs.writeFile(path.join(report.report_dir, "integration-report.json"), JSON.stringify(report, null, 2))
  await fs.writeFile(path.join(report.report_dir, "integration-report.md"), markdownReport(report))
}

const TestInitCommand = effectCmd({
  command: "init",
  describe: "create OpenChinaCode Playwright integration test templates",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("force", {
        type: "boolean",
        describe: "overwrite existing generated templates and integration_test config",
      })
      .option("base-url", { type: "string", describe: "default frontend base URL" })
      .option("health-url", { type: "string", describe: "optional backend health URL" })
      .option("frontend-command", { type: "string", describe: "frontend service command" })
      .option("backend-command", { type: "string", describe: "backend service command" })
      .option("frontend-port", { type: "number", describe: "frontend readiness port" })
      .option("backend-port", { type: "number", describe: "backend readiness port" })
      .option("report-dir", { type: "string", describe: "integration report directory" }),
  handler: Effect.fn("Cli.test.init")(function* (args) {
    const result = yield* Effect.promise(() =>
      initIntegrationKit({
        root: process.cwd(),
        force: args.force,
        baseURL: args.baseUrl,
        healthURL: args.healthUrl,
        frontendCommand: args.frontendCommand,
        backendCommand: args.backendCommand,
        frontendPort: args.frontendPort,
        backendPort: args.backendPort,
        reportDir: args.reportDir,
      }),
    )
    process.stdout.write(`OpenChinaCode integration test kit initialized (${result.packageManager}).${EOL}`)
    for (const file of result.files) process.stdout.write(`created ${path.relative(process.cwd(), file)}${EOL}`)
    for (const file of result.skipped) process.stdout.write(`kept ${path.relative(process.cwd(), file)}${EOL}`)
    process.stdout.write(
      `${result.configUpdated ? "updated" : "kept"} ${path.relative(process.cwd(), result.configPath)}${EOL}`,
    )
  }),
})

const TestMcpCommand = effectCmd({
  command: "mcp",
  describe: "write a Playwright MCP config template",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("global", {
        type: "boolean",
        describe: "write to the global OpenChinaCode config instead of this project",
      })
      .option("name", { type: "string", default: DEFAULT_MCP_NAME, describe: "MCP server name" })
      .option("disable", { type: "boolean", describe: "write the template disabled" })
      .option("headed", { type: "boolean", describe: "run Playwright MCP headed instead of headless" })
      .option("timeout", { type: "number", describe: "MCP request timeout in milliseconds" }),
  handler: Effect.fn("Cli.test.mcp")(function* (args) {
    const file = args.global
      ? path.join(Global.Path.config, "openchinacode.jsonc")
      : path.join(process.cwd(), "openchinacode.jsonc")
    const before = existsSync(file) ? yield* Effect.promise(() => fs.readFile(file, "utf8")) : "{\n}\n"
    const after = patchPlaywrightMcpText(before, {
      name: args.name,
      enabled: !args.disable,
      headless: !args.headed,
      timeout: args.timeout,
    })
    yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
    yield* Effect.promise(() => fs.writeFile(file, after))
    process.stdout.write(`Playwright MCP template written to ${file}${EOL}`)
  }),
})

const TestRunCommand = effectCmd({
  command: "run",
  describe: "run OpenChinaCode integration tests and write a report",
  builder: (yargs) =>
    yargs
      .option("base-url", { type: "string", describe: "override integration_test.base_url" })
      .option("health-url", { type: "string", describe: "override integration_test.health_url" })
      .option("config", { type: "string", describe: "Playwright config path" })
      .option("report-dir", { type: "string", describe: "base report directory" })
      .option("start", {
        type: "boolean",
        default: true,
        describe: "start configured frontend/backend services; use --no-start to reuse existing services",
      })
      .option("headed", { type: "boolean", describe: "run Playwright headed" }),
  handler: Effect.fn("Cli.test.run")(function* (args) {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const cfg = yield* Config.Service.use((svc) => svc.get())
    const integration = cfg.integration_test ?? {}
    const root = process.cwd()
    const baseURL = args.baseUrl ?? integration.base_url
    const healthURL = args.healthUrl ?? integration.health_url
    const playwrightConfig = resolvePath(
      root,
      args.config ?? integration.playwright_config ?? DEFAULT_PLAYWRIGHT_CONFIG,
    )
    if (!existsSync(playwrightConfig)) {
      return yield* fail(`Missing Playwright config: ${playwrightConfig}\nRun: openchinacode test init`)
    }
    const reportBase = resolvePath(root, args.reportDir ?? integration.report_dir ?? DEFAULT_REPORT_DIR)
    const reportDir = path.join(reportBase, `integration-${stamp()}`)
    const playwrightReportDir = path.join(reportDir, "playwright")
    yield* Effect.promise(() => fs.mkdir(playwrightReportDir, { recursive: true }))

    const startedAt = new Date().toISOString()
    const services: Array<{ child: ChildProcess; info: ServiceInfo }> = []
    const checks: Check[] = []
    try {
      if (args.start !== false) {
        if (integration.backend?.command)
          services.push(yield* Effect.promise(() => startService(root, reportDir, "backend", integration.backend!)))
        if (integration.frontend?.command)
          services.push(yield* Effect.promise(() => startService(root, reportDir, "frontend", integration.frontend!)))
      }

      for (const service of services) {
        checks.push({
          name: `${service.info.name} readiness`,
          status: service.info.ready ? "passed" : "failed",
          detail: service.info.error ?? service.info.logPath,
        })
      }
      if (healthURL) checks.push(yield* Effect.promise(() => waitForHealth(healthURL, 60_000)))

      const pm = detectPackageManager(root)
      const [command, ...pwArgs] = packageExecArgs(pm, ["playwright", "test", "-c", playwrightConfig])
      const outputLog = path.join(reportDir, "playwright.log")
      const env = {
        ...process.env,
        ...(baseURL ? { OPENCHINACODE_BASE_URL: baseURL } : {}),
        ...(healthURL ? { OPENCHINACODE_HEALTH_URL: healthURL } : {}),
        OPENCHINACODE_PLAYWRIGHT_REPORT_DIR: playwrightReportDir,
        ...(args.headed ? { PWHEADED: "1" } : {}),
      }
      const playwright = yield* Effect.promise(() =>
        runProcess({ command, args: pwArgs, cwd: root, env, logPath: outputLog }),
      )
      const failed = checks.some((check) => check.status === "failed") || playwright.code !== 0
      const report: RunReport = {
        status: failed ? "failed" : "passed",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        root,
        base_url: baseURL,
        health_url: healthURL,
        report_dir: reportDir,
        playwright_config: playwrightConfig,
        services: services.map((service) => service.info),
        checks,
        playwright: {
          command: [command, ...pwArgs].join(" "),
          exit_code: playwright.code,
          output_log: outputLog,
          report_dir: playwrightReportDir,
        },
      }
      yield* Effect.promise(() => writeReport(report))
      process.stdout.write(`OpenChinaCode integration report: ${path.join(reportDir, "integration-report.md")}${EOL}`)
      if (failed) return yield* fail(`Integration tests failed. See ${path.join(reportDir, "integration-report.md")}`)
    } finally {
      yield* Effect.promise(() =>
        Promise.all(services.map((service) => stopService(service.child))).then(() => undefined),
      )
    }
  }),
})

export const TestCommand = cmd({
  command: "test",
  describe: "OpenChinaCode integration test kit",
  builder: (yargs) => yargs.command(TestInitCommand).command(TestMcpCommand).command(TestRunCommand).demandCommand(),
  handler() {},
})
