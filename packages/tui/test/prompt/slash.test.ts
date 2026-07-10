import { describe, expect, test } from "bun:test"
import {
  parseAutoMaxTokensSlashAction,
  parseDirectSlashCommand,
  parseLspSlashAction,
  parseTestMcpSlashAction,
} from "../../src/component/prompt/slash"

describe("prompt slash commands", () => {
  test("parses direct slash command arguments", () => {
    expect(parseDirectSlashCommand("/lsp on")).toEqual({ command: "lsp", args: "on" })
    expect(parseDirectSlashCommand("/test-mcp on")).toEqual({ command: "test-mcp", args: "on" })
    expect(parseDirectSlashCommand("/LSP   status")).toEqual({ command: "lsp", args: "status" })
    expect(parseDirectSlashCommand("hello /lsp")).toBeUndefined()
    expect(parseDirectSlashCommand("/")).toBeUndefined()
  })

  test("parses LSP actions", () => {
    expect(parseLspSlashAction("")).toBe("status")
    expect(parseLspSlashAction("status")).toBe("status")
    expect(parseLspSlashAction("on")).toBe("on")
    expect(parseLspSlashAction("enable")).toBe("on")
    expect(parseLspSlashAction("off")).toBe("off")
    expect(parseLspSlashAction("disable")).toBe("off")
    expect(parseLspSlashAction("tool on")).toBe("help")
  })

  test("parses Playwright MCP actions", () => {
    expect(parseTestMcpSlashAction("")).toEqual({ type: "status" })
    expect(parseTestMcpSlashAction("status")).toEqual({ type: "status" })
    expect(parseTestMcpSlashAction("on")).toEqual({ type: "on", headless: undefined })
    expect(parseTestMcpSlashAction("enable headed")).toEqual({ type: "on", headless: false })
    expect(parseTestMcpSlashAction("headless")).toEqual({ type: "on", headless: true })
    expect(parseTestMcpSlashAction("headed")).toEqual({ type: "on", headless: false })
    expect(parseTestMcpSlashAction("off")).toEqual({ type: "off" })
    expect(parseTestMcpSlashAction("toggle")).toEqual({ type: "toggle" })
    expect(parseTestMcpSlashAction("tool on")).toEqual({ type: "help" })
  })

  test("parses auto max tokens actions", () => {
    expect(parseAutoMaxTokensSlashAction("")).toEqual({ type: "status" })
    expect(parseAutoMaxTokensSlashAction("status")).toEqual({ type: "status" })
    expect(parseAutoMaxTokensSlashAction("off")).toEqual({ type: "off" })
    expect(parseAutoMaxTokensSlashAction("on")).toEqual({ type: "heuristic" })
    expect(parseAutoMaxTokensSlashAction("heuristic")).toEqual({ type: "heuristic" })
    expect(parseAutoMaxTokensSlashAction("llm")).toEqual({ type: "llm" })
    expect(parseAutoMaxTokensSlashAction("llm deepseek/deepseek-v4-flash")).toEqual({
      type: "llm",
      model: "deepseek/deepseek-v4-flash",
    })
    expect(parseAutoMaxTokensSlashAction("model deepseek/deepseek-v4-flash")).toEqual({
      type: "model",
      model: "deepseek/deepseek-v4-flash",
    })
    expect(parseAutoMaxTokensSlashAction("model")).toEqual({ type: "help" })
  })
})
