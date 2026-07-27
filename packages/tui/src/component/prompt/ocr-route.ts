type ModelFilePart = {
  type: string
  mime: string
  filename?: string
  url: string
  source?: { type?: string; path?: string }
}

const OCR_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
])

const OCR_DOCUMENT_EXTENSIONS = new Set([".pdf", ".ofd", ".doc", ".docx", ".txt", ".wps", ".ppt", ".pptx"])
const OCR_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/bmp", "image/tiff"])
const OCR_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"])

export function isOcrDocumentFilePart(part: unknown): part is ModelFilePart {
  if (!isFilePart(part)) return false
  if (OCR_DOCUMENT_MIMES.has(part.mime)) return true
  return OCR_DOCUMENT_EXTENSIONS.has(extension(part.filename || part.source?.path || part.url))
}

export function isOcrSupportedImageFilePart(part: unknown): part is ModelFilePart {
  if (!isFilePart(part)) return false
  if (OCR_IMAGE_MIMES.has(part.mime)) return true
  return OCR_IMAGE_EXTENSIONS.has(extension(part.filename || part.source?.path || part.url))
}

export function ocrFilePartReference(part: ModelFilePart) {
  if (part.source?.type === "file" && part.source.path) return part.source.path
  return part.url
}

export function ocrPreprocessUserText(inputText: string, files: string[]) {
  const original = inputText.trim() || "请先解析我粘贴的文档，然后基于解析结果继续处理。"
  return [
    original,
    "",
    "<openchinacode-ocr>",
    `The user pasted ${files.length} OCR-capable file(s).`,
    "Before answering, call the ocr_extract tool for these file(s). Use the returned markdown_path/json_path content as the authoritative extracted document text and structure.",
    "If the user asks for summary, analysis, translation, comparison, or table extraction, read the returned markdown_path before answering.",
    "Do not send the raw document attachments directly to the chat model.",
    "",
    "OCR file reference(s):",
    files.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "</openchinacode-ocr>",
  ].join("\n")
}

function isFilePart(part: unknown): part is ModelFilePart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as ModelFilePart).type === "file" &&
    typeof (part as ModelFilePart).mime === "string" &&
    typeof (part as ModelFilePart).url === "string"
  )
}

function extension(input: string) {
  const clean = input.split(/[?#]/)[0]?.toLowerCase() ?? ""
  const index = clean.lastIndexOf(".")
  return index >= 0 ? clean.slice(index) : ""
}
