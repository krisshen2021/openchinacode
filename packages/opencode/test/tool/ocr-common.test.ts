import { describe, expect, test } from "bun:test"
import { isSupportedOcrExtension, isSupportedOcrMime, ocrOutputRoot } from "../../src/tool/ocr-common"

describe("Baidu Unlimited-OCR helpers", () => {
  test("recognizes official OCR document and image formats", () => {
    expect(isSupportedOcrExtension("/tmp/a.pdf")).toBe(true)
    expect(isSupportedOcrExtension("/tmp/a.ofd")).toBe(true)
    expect(isSupportedOcrExtension("/tmp/a.docx")).toBe(true)
    expect(isSupportedOcrExtension("/tmp/a.pptx")).toBe(true)
    expect(isSupportedOcrExtension("/tmp/a.xlsx")).toBe(false)

    expect(isSupportedOcrMime("application/pdf")).toBe(true)
    expect(isSupportedOcrMime("image/png")).toBe(true)
    expect(isSupportedOcrMime("image/png", false)).toBe(false)
  })

  test("defaults OCR output to tmp and resolves custom output from worktree", () => {
    const instance = { worktree: "/repo" } as any
    expect(ocrOutputRoot(instance)).toBe("/tmp/openchinacode/ocr")
    expect(ocrOutputRoot(instance, "out/ocr")).toBe("/repo/out/ocr")
  })
})
