import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { parse } from "jsonc-parser"
import { tmpdir } from "../fixture/fixture"
import {
  DEFAULT_PLAYWRIGHT_CONFIG,
  detectPackageManager,
  initIntegrationKit,
  patchIntegrationConfigText,
  patchPlaywrightMcpText,
} from "../../src/integration-test/kit"

describe("OpenChinaCode integration test kit", () => {
  test("detects package manager from lockfiles", async () => {
    await using dir = await tmpdir()
    expect(detectPackageManager(dir.path)).toBe("npm")
    await fs.writeFile(path.join(dir.path, "pnpm-lock.yaml"), "")
    expect(detectPackageManager(dir.path)).toBe("pnpm")
    await fs.writeFile(path.join(dir.path, "bun.lock"), "")
    expect(detectPackageManager(dir.path)).toBe("bun")
  })

  test("initializes Playwright templates and integration_test config", async () => {
    await using dir = await tmpdir({
      init: async (root) => {
        await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite --host 0.0.0.0" } }))
      },
    })

    const result = await initIntegrationKit({ root: dir.path, healthURL: "http://127.0.0.1:8000/health" })
    expect(result.configUpdated).toBe(true)
    expect(result.packageManager).toBe("npm")
    expect(await fs.readFile(path.join(dir.path, DEFAULT_PLAYWRIGHT_CONFIG), "utf8")).toContain("defineConfig")
    expect(await fs.readFile(path.join(dir.path, ".openchinacode/test-kit/e2e/smoke.spec.ts"), "utf8")).toContain(
      "homepage loads without browser errors",
    )

    const config = parse(await fs.readFile(path.join(dir.path, "openchinacode.jsonc"), "utf8")) as {
      integration_test: { base_url: string; health_url: string; frontend: { port: number } }
    }
    expect(config.integration_test.base_url).toBe("http://127.0.0.1:5173")
    expect(config.integration_test.health_url).toBe("http://127.0.0.1:8000/health")
    expect(config.integration_test.frontend.port).toBe(5173)
  })

  test("does not replace existing integration_test config unless forced", () => {
    const before = '{ "integration_test": { "base_url": "http://example.test" } }'
    const kept = patchIntegrationConfigText(before, { base_url: "http://127.0.0.1:5173" }, false)
    expect(kept.changed).toBe(false)
    expect(parse(kept.text).integration_test.base_url).toBe("http://example.test")

    const forced = patchIntegrationConfigText(before, { base_url: "http://127.0.0.1:5173" }, true)
    expect(forced.changed).toBe(true)
    expect(parse(forced.text).integration_test.base_url).toBe("http://127.0.0.1:5173")
  })

  test("writes Playwright MCP config in jsonc", () => {
    const text = patchPlaywrightMcpText("{\n}\n", { timeout: 45_000 })
    const parsed = parse(text) as {
      mcp: { playwright: { type: string; command: string[]; enabled: boolean; timeout: number } }
    }
    expect(parsed.mcp.playwright.type).toBe("local")
    expect(parsed.mcp.playwright.command).toEqual([
      "openchinacode",
      "mcp",
      "playwright",
      "--headless",
      "--browser=chrome",
      "--caps=default",
    ])
    expect(parsed.mcp.playwright.enabled).toBe(true)
    expect(parsed.mcp.playwright.timeout).toBe(45_000)
  })
})
