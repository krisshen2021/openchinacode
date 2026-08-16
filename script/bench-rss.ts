// script/bench-rss.ts — measure CLI memory at defined checkpoints.
// Usage: bun run script/bench-rss.ts
import { spawnSync } from "node:child_process"

// Anchor cwd to the repo root (this script lives in script/) so the relative
// CLI path resolves regardless of the caller's working directory.
const ROOT = import.meta.dir + "/.."
const CLI = ["run", "--conditions=browser", "packages/opencode/src/index.ts"]

// `/usr/bin/time -v` reports the child's ru_maxrss after exit, so unlike ps
// polling there is no sampling race against short-lived invocations.
function maxRss(args: string[]): number {
  const result = spawnSync("/usr/bin/time", ["-v", "bun", ...CLI, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 120_000,
  })
  const stderr = result.stderr.toString()
  const match = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/)
  if (!match) throw new Error(`no rusage for: ${args.join(" ")}\n${stderr.slice(-400)}`)
  return Number(match[1]) / 1024
}

const rows: [string, number][] = [
  ["--help (module graph only)", maxRss(["--help"])],
  ["models --help", maxRss(["models", "--help"])],
]
for (const [label, mb] of rows) console.log(`${label.padEnd(34)} peak RSS ${mb.toFixed(0)} MB`)
