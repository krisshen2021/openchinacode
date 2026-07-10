# OpenChinaCode Site

Static Cloudflare Pages site for `openchinacode.muffin-labs.com`.

## Pages Setup

Create a Cloudflare Pages project from the GitHub repository.

- Framework preset: `None`
- Root directory: `site`
- Build command: leave empty, or use `:` if the UI requires a command
- Build output directory: `.`
- Deploy command: `npx wrangler pages deploy . --project-name openchinacode --branch main`

If Cloudflare logs show it is still running from the repository root, use this
deploy command instead:

```bash
cd site && npx wrangler pages deploy . --project-name openchinacode --branch main
```

Do not use `npx wrangler deploy` in a Pages project. That command deploys a
Worker, not Pages. The correct command is `wrangler pages deploy`.

## API Token

If the deploy command uses Wrangler, the `CLOUDFLARE_API_TOKEN` environment
variable must have Pages deployment permission.

Create a custom Cloudflare API token with:

- Account > Cloudflare Pages > Edit
- Account Resources > Include > the account that owns `muffin-labs.com`

Then set that value as `CLOUDFLARE_API_TOKEN` in the Pages project's build
environment variables for production and preview.

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
