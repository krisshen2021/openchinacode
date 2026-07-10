# OpenChinaCode Cloudflare Worker

This Worker serves the public OpenChinaCode homepage and keeps the one-line installer at:

```bash
curl -fsSL https://openchinacode.muffin-labs.com/install | bash
```

## Routes

- `/` - OpenChinaCode landing page
- `/install` - proxies the repository install script from GitHub raw
- `/install.sh` - same as `/install`
- `/github` - redirects to the GitHub repository
- `/releases` - redirects to the latest GitHub Release

## Dashboard Deploy

1. Open Cloudflare Dashboard.
2. Go to `Workers & Pages`.
3. Select the Worker bound to `openchinacode.muffin-labs.com`.
4. Replace the Worker source with `cloudflare/openchinacode-worker.js`.
5. Save and deploy.

The existing custom domain can stay unchanged.

## Wrangler Deploy

If Wrangler is authenticated locally:

```bash
npx wrangler deploy cloudflare/openchinacode-worker.js --name openchinacode-site
```

Then bind `openchinacode.muffin-labs.com` as the Worker custom domain in Cloudflare.
