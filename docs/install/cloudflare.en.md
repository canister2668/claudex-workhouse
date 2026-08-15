# Cloudflare Tunnel and Access

[Guidebook](../guide.en.md) · [한국어](cloudflare.md) · [日本語](cloudflare.ja.md)

Cloudflare is optional. The default scope connects and diagnoses a Tunnel and
Access application created by the operator. The wizard can also create
Workhouse-owned token-file and host/sidecar launch files. It does not request
an account password or an account-wide API token.

## Existing host tunnel

```text
Browser → Cloudflare Access → Cloudflare Tunnel
        → http://127.0.0.1:3410 → Workhouse
```

Keep a Docker-published port bound to loopback, for example
`127.0.0.1:3410:3410`. A Tunnel without Access can expose the management UI;
the wizard therefore reports reachability and authentication protection as
separate checks.

## Managed host or sidecar files

The managed mode stores the Tunnel token at
`config/external-access/cloudflared.token` with mode `0600`, never in command
arguments, API responses, SQLite, audit details, or support output. Its Compose
fragment does not mount the Docker socket. Review and run the fixed operator
command shown by the plan.

Workhouse does not overwrite or remove an unowned service, route, credential
JSON, or config file. For a same-Compose advanced setup, use the Workhouse
service name as the origin rather than `localhost`; the default generated
sidecar instead uses host networking to preserve the loopback origin.

## Wizard sequence

1. Detect a host executable, process/service, Docker container, credential mode, and safe config candidates.
2. Select existing validation, managed host, or managed sidecar.
3. Enter the HTTPS hostname, Access team domain, application AUD, exact email, and—only for managed mode—the Tunnel token.
4. Review exposure, authentication boundary, files, fixed operator command, restart requirement, and rollback.
5. Apply only Workhouse-owned files.
6. Test local health, DNS, TLS, anonymous Access boundary, HTML, API, manifest, and origin consistency.
7. Recheck from an authenticated browser and display the URL and QR code.

An anonymous redirect proves that an Access boundary exists, not that a
particular exact-email policy is correct. Confirm the policy and Tunnel route
in Zero Trust, restart Workhouse to load authentication changes, and repeat
the authenticated SSE/PWA checks.

The QR code contains only the URL. It never contains a Tunnel token, Access
cookie, or Worker credential. Workers should normally use a local network or
Tailscale; Access-protected Worker WSS requires a separate service-token design.

Previous: [Installation](index.en.md) · Next: [Connectivity troubleshooting](connectivity-troubleshooting.en.md) · [Compare Tailscale](tailscale.en.md) · [Guidebook](../guide.en.md)
