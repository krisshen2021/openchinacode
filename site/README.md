# OpenChinaCode Site

Static Cloudflare Pages site for `openchinacode.muffin-labs.com`.

## Pages Setup

Create a Cloudflare Pages project from the GitHub repository.

- Framework preset: `None`
- Root directory: `site`
- Build command: leave empty, or use `:` if the UI requires a command
- Build output directory: `.`
- Deploy command: leave empty

Do not use `npx wrangler deploy` in a Pages Git build. That command deploys a
Worker, not a Pages project. The Pages build system deploys the output directory
itself after the build command finishes.

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
