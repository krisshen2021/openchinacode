# OpenChinaCode Site

Static Cloudflare Pages site for `openchinacode.muffin-labs.com`.

## Pages Setup

Create a Cloudflare Pages project from the GitHub repository.

- Framework preset: `None`
- Root directory: `site`
- Build command: leave empty
- Build output directory: `.`

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
