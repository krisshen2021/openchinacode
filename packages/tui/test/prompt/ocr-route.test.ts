import { describe, expect, test } from "bun:test"
import {
  hasOcrIntent,
  isOcrDocumentFilePart,
  isOcrSupportedImageFilePart,
  ocrFilePartReference,
  ocrPreprocessUserText,
  shouldRouteImageToOcr,
} from "../../src/component/prompt/ocr-route"

const pdfPart = {
  type: "file",
  mime: "application/pdf",
  filename: "sample.pdf",
  url: "data:application/pdf;base64,AAA",
  source: { type: "file", path: "/tmp/sample.pdf" },
}

const imagePart = {
  type: "file",
  mime: "image/png",
  filename: "screen.png",
  url: "data:image/png;base64,AAA",
  source: { type: "file", path: "/tmp/screen.png" },
}

describe("prompt OCR routing", () => {
  test("routes document attachments to OCR", () => {
    expect(isOcrDocumentFilePart(pdfPart)).toBe(true)
    expect(ocrFilePartReference(pdfPart)).toBe("/tmp/sample.pdf")
  })

  test("routes images to OCR only when prompt asks for OCR-like extraction", () => {
    expect(isOcrSupportedImageFilePart(imagePart)).toBe(true)
    expect(hasOcrIntent("请提取这张图里的表格并转成 Markdown")).toBe(true)
    expect(shouldRouteImageToOcr({ part: imagePart, prompt: "请提取这张图里的表格" })).toBe(true)
    expect(shouldRouteImageToOcr({ part: imagePart, prompt: "看看这个 UI 的按钮颜色对不对" })).toBe(false)
  })

  test("builds an explicit OCR tool instruction", () => {
    const text = ocrPreprocessUserText("总结这个 PDF", ["/tmp/a.pdf"])
    expect(text).toContain("ocr_extract")
    expect(text).toContain("/tmp/a.pdf")
    expect(text).toContain("Do not send the raw document attachments")
  })
})
