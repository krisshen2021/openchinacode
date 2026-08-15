import { describe, expect, test } from "bun:test"
import {
  parseAutoMaxTokensSlashAction,
  parseCompactSlashAction,
  parseDirectSlashCommand,
  parseLspSlashAction,
  parseRetentionTurnsSlashAction,
  parseSoulSlashAction,
  parseTestMcpSlashAction,
  parseTokenOptimizationSlashAction,
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

  test("parses compact actions", () => {
    expect(parseCompactSlashAction("")).toEqual({ type: "run" })
    expect(parseCompactSlashAction("auto")).toEqual({ type: "run" })
    expect(parseCompactSlashAction("smart")).toEqual({ type: "run" })
    expect(parseCompactSlashAction("keep 3")).toEqual({ type: "run", manualKeepTurns: 3 })
    expect(parseCompactSlashAction("keep auto")).toEqual({ type: "run" })
    expect(parseCompactSlashAction("keep -1")).toEqual({ type: "help" })
    expect(parseCompactSlashAction("keep 1 extra")).toEqual({ type: "help" })
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

  test("parses soul actions", () => {
    expect(parseSoulSlashAction("")).toEqual({ type: "dialog" })
    expect(parseSoulSlashAction("rigorous")).toEqual({ type: "set", soul: "rigorous" })
    expect(parseSoulSlashAction("friendly")).toEqual({ type: "set", soul: "friendly" })
    expect(parseSoulSlashAction("custom")).toEqual({ type: "set", soul: "custom" })
    expect(parseSoulSlashAction("unknown")).toEqual({ type: "help" })
  })

  test("parses retention turns actions", () => {
    expect(parseRetentionTurnsSlashAction("")).toEqual({ type: "status" })
    expect(parseRetentionTurnsSlashAction("status")).toEqual({ type: "status" })
    expect(parseRetentionTurnsSlashAction("4")).toEqual({ type: "set", turns: 4 })
    expect(parseRetentionTurnsSlashAction("0")).toEqual({ type: "set", turns: 0 })
    expect(parseRetentionTurnsSlashAction("off")).toEqual({ type: "off" })
    expect(parseRetentionTurnsSlashAction("default")).toEqual({ type: "off" })
    expect(parseRetentionTurnsSlashAction("inherit")).toEqual({ type: "off" })
    expect(parseRetentionTurnsSlashAction("unset")).toEqual({ type: "off" })
    expect(parseRetentionTurnsSlashAction("-1")).toEqual({ type: "help" })
    expect(parseRetentionTurnsSlashAction("1.5")).toEqual({ type: "help" })
    expect(parseRetentionTurnsSlashAction("abc")).toEqual({ type: "help" })
  })

  test("parses token optimization actions", () => {
    expect(parseTokenOptimizationSlashAction("")).toEqual({ type: "status" })
    expect(parseTokenOptimizationSlashAction("status")).toEqual({ type: "status" })
    expect(parseTokenOptimizationSlashAction("on")).toEqual({ type: "on" })
    expect(parseTokenOptimizationSlashAction("unlock")).toEqual({ type: "on" })
    expect(parseTokenOptimizationSlashAction("off")).toEqual({ type: "off" })
    expect(parseTokenOptimizationSlashAction("lock")).toEqual({ type: "off" })
    expect(parseTokenOptimizationSlashAction("default")).toEqual({ type: "on" })
    expect(parseTokenOptimizationSlashAction("inherit")).toEqual({ type: "on" })
    expect(parseTokenOptimizationSlashAction("bogus")).toEqual({ type: "help" })
  })
})
