import { describe, expect, test } from "bun:test"
import { parseClipboardFileList } from "../src/clipboard"

describe("clipboard file list parsing", () => {
  test("parses text/uri-list and GNOME copied file lists", () => {
    expect(parseClipboardFileList("copy\nfile:///home/kris/Documents/a.pdf\nfile:///tmp/b%20c.png\n")).toEqual([
      "/home/kris/Documents/a.pdf",
      "/tmp/b c.png",
    ])
  })

  test("ignores comments, relative entries, and unsupported lines", () => {
    expect(parseClipboardFileList("# comment\ncut\nrelative.pdf\n/home/kris/file.docx\n")).toEqual([
      "/home/kris/file.docx",
    ])
  })
})
