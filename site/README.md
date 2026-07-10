# OpenChinaCode Site

Static Cloudflare Pages site for `openchinacode.muffin-labs.com`.

## Pages Setup

Create a Cloudflare Pages project from the GitHub repository.

- Framework preset: `None`
- Root directory: `site`
- Build command: leave empty, or use `:` if the UI requires a command
- Build output directory: `.`
- Deploy command: `npx wrangler pages deploy . --project-name openchinacode --branch main`

If the Cloudflare UI does not honor `Root directory: site`, use this deploy
command from the repository root instead:

```bash
npx wrangler pages deploy site --project-name openchinacode --branch main
```

Do not use `npx wrangler deploy` in a Pages project. That command deploys a
Worker, not Pages. The correct command is `wrangler pages deploy`.

Then attach the custom domain:

```text
openchinacode.muffin-labs.com
```

## Routes

- `/` - static homepage from `index.html`
- `/install` - Pages Function that proxies the GitHub raw install script
- `/install.sh` - same installer endpoint
- `/github` - redirects to the GitHub repository
- `/releases` - redirects to the latest GitHub Release

Cloudflare Workers can return HTML directly, but this homepage is better deployed
as Pages static content because the dashboard Worker editor can be unreliable with
large inline HTML strings.
