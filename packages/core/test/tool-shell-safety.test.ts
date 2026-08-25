import { describe, expect, test } from "bun:test"
import { ShellSafety } from "../src/tool/shell-safety"

const allowed: Array<[string, string]> = [
  [
    "query-string ampersand inside double quotes",
    'curl -s "https://cloudflare-dns.com/dns-query?name=sidegame.ai&type=NS" -H "accept: application/dns-json"',
  ],
  ["query-string ampersand inside single quotes", "curl 'https://example.com?a=1&b=2'"],
  ["escaped ampersand", "echo foo \\& bar"],
  ["and-operator chaining", "git log --oneline -5 && git status"],
  ["stderr redirect", "bun script/build.ts --single 2>&1 | tail -2"],
  ["grep on tsx file", 'grep -n "pattern" packages/tui/src/component/prompt/index.tsx | head -20'],
  ["cat vite config", "cat vite.config.ts"],
  ["sed on dev path", "sed -n '1,5p' src/dev-server.ts"],
  ["echo of blocked text", 'echo "npm run dev"'],
  ["ls on tsx binary path", "ls node_modules/.bin/tsx"],
  ["build script via bun", "bun script/build.ts --single"],
  ["typecheck via bun", "bun typecheck"],
  ["kill of specific pid", "kill 4242"],
  ["pkill mention inside echo", 'echo "pkill -f node"'],
  ["nohup mention inside echo", 'echo "use nohup to detach"'],
  ["xargs with non-kill command", "ls | xargs ls"],
]

const blockedLongRunning: Array<[string, string]> = [
  ["npm run dev", "npm run dev"],
  ["bun dev", "bun dev"],
  ["yarn start", "yarn start"],
  ["pnpm serve", "pnpm serve"],
  ["npm preview", "npm run preview"],
  ["npx tsx", "npx tsx watch server.ts"],
  ["tsx direct", "tsx server/index.ts"],
  ["vite", "vite"],
  ["next dev", "next dev"],
  ["nuxt dev", "nuxt dev"],
  ["uvicorn", "uvicorn app:app --reload"],
  ["flask", "flask run"],
  ["python http.server", "python -m http.server 8000"],
  ["python3 http.server", "python3 -m http.server"],
  ["after pipe", "npm run dev | tee log.txt"],
  ["after and-operator", "cd app && npm run dev"],
  ["after semicolon", "cd app; bun dev"],
  ["with env assignment", "PORT=3000 npm run dev"],
  ["through sudo", "sudo npm run dev"],
  ["long-running with ampersand reports long-running reason", "npm run dev & echo started"],
]

const blockedBackground: Array<[string, string]> = [
  ["trailing ampersand", "sleep 100 &"],
  ["nohup", "nohup node server.js"],
  ["setsid", "setsid bun dev"],
  ["disown", "disown %1"],
]

const blockedKill: Array<[string, string]> = [
  ["pkill -f node", "pkill -9 -f node"],
  ["pkill -f quoted tsx server", 'pkill -9 -f "tsx server/index"'],
  ["killall node", "killall node"],
  ["xargs kill", "ps aux | xargs kill"],
  ["xargs kill -9", "ps aux | xargs kill -9"],
]

describe("ShellSafety.safetyBlock", () => {
  test.each(allowed)("allows: %s", (_label, command) => {
    expect(ShellSafety.safetyBlock(command)).toBeUndefined()
  })

  test.each(blockedLongRunning)("blocks long-running: %s", (_label, command) => {
    expect(ShellSafety.safetyBlock(command)).toContain("process_start")
  })

  test.each(blockedBackground)("blocks background: %s", (_label, command) => {
    expect(ShellSafety.safetyBlock(command)).toContain("not observable or stoppable")
  })

  test.each(blockedKill)("blocks broad kill: %s", (_label, command) => {
    expect(ShellSafety.safetyBlock(command)).toContain("process_stop")
  })
})
