// script/bench-rss.ts — measure CLI memory at defined checkpoints.
// Usage: bun run script/bench-rss.ts
import { spawn } from "node:child_process"

const CLI = ["bun", "run", "--conditions=browser", "packages/opencode/src/index.ts"]
// Anchor cwd to the repo root (this script lives in script/) so the relative
// CLI path resolves regardless of the caller's working directory.
const ROOT = import.meta.dir + "/.."

async function maxRss(args: string[], killAfterMs: number): Promise<number> {
  const child = spawn(CLI[0], [...CLI.slice(1), ...args], { stdio: "ignore", cwd: ROOT })
  let peak = 0
  const timer = setInterval(() => {
    try {
      const status = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(child.pid)]).stdout.toString().trim()
      peak = Math.max(peak, Number(status) || 0)
    } catch {}
  }, 250)
  await new Promise<void>((resolve) => {
    const killer = setTimeout(() => {
      child.kill("SIGTERM")
      resolve()
    }, killAfterMs)
    child.on("exit", () => {
      clearTimeout(killer)
      resolve()
    })
  })
  clearInterval(timer)
  return peak / 1024 // MB
}

const rows: [string, number][] = []
rows.push(["--help (module graph only)", await maxRss(["--help"], 60_000)])
rows.push(["models --help", await maxRss(["models", "--help"], 60_000)])
for (const [label, mb] of rows) console.log(`${label.padEnd(34)} peak RSS ${mb.toFixed(0)} MB`)
