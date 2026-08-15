# Cloudflare Access

No hostname route has been added. Team Domain and Application AUD were not available from local credentials and must not be guessed.

Official references: [publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) and [validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Required order

1. In Cloudflare Zero Trust, create a self-hosted Access application for `claudex-workhouse.example.com`.
2. Add an Allow policy containing one exact email: `admin@example.com`. Do not allow the whole domain, all Google identities, or arbitrary one-time PIN recipients.
3. Confirm the application is active, then copy:
   - Team Domain from Zero Trust > Settings > Custom Pages/Team domain (for example, the actual `https://<team>.cloudflareaccess.com` value shown by Cloudflare).
   - Application AUD from Access > Applications > Claudex Workhouse > application configuration/overview.
4. Enter the actual values in `$CLAUDEX_WORKHOUSE_ROOT/config/claudex-workhouse.json` fields `teamDomain` and `audience`, or set `CLAUDEX_WORKHOUSE_TEAM_DOMAIN` and `CLAUDEX_WORKHOUSE_AUDIENCE` in the service environment.
5. Restart Claudex Workhouse and validate a real Access JWT locally before publishing the route.
6. Only then add the remotely managed Tunnel public hostname `claudex-workhouse.example.com` with service `http://127.0.0.1:3410`.

nginx is not involved and must remain unchanged.

## Validation

After authenticating through Access, obtain a current assertion from a browser request or Cloudflare diagnostic flow without writing it to logs. Then run from a private shell:

```sh
curl -sS -H "Cf-Access-Jwt-Assertion: $ACCESS_JWT" \
  http://127.0.0.1:3410/api/health
```

Expected: HTTP 200, exact email accepted, `accessConfigured:true`. Negative tests must reject a missing token, wrong audience, wrong issuer, expired token, and any email other than `admin@example.com`.

Finally verify the public URL redirects unauthenticated users to Access and returns the PWA only after the exact-email policy succeeds. Do not add the Tunnel route if any JWT test fails.
