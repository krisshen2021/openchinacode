# OpenChinaCode Site

Static Cloudflare Pages site for `openchinacode.muffin-labs.com`.

## Pages Setup

The production site is deployed by Cloudflare Pages through the GitHub
integration. Updating files under `site/`, committing, and pushing to `main`
triggers a new deployment automatically.

- Framework preset: `None`
- Root directory: `site`
- Build command: leave empty, or use `:` if the UI requires a command
- Build output directory: `.`

The custom domain is attached in Cloudflare Pages:

```text
openchinacode.muffin-labs.com
```

Do not configure a Wrangler deploy command for the normal Pages build. The
repository is the source of truth, and Cloudflare handles deployment after push.

## Routes

- `/` - static homepage from `index.html`
- `/install` - Pages Function that proxies the GitHub raw install script
- `/install.sh` - same installer endpoint
- `/github` - redirects to the GitHub repository
- `/releases` - redirects to the latest GitHub Release

Cloudflare Workers can return HTML directly, but this homepage is better deployed
as Pages static content because the dashboard Worker editor can be unreliable with
large inline HTML strings.
