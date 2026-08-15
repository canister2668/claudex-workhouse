# Connect through Tailscale

[Guidebook](../guide.en.md) · [한국어](tailscale.md) · [日本語](tailscale.ja.md)

Tailscale is the recommended private path for reaching Workhouse from a
personal phone or computer. Workhouse does not manage account creation,
passwords, reusable auth keys, ACLs, or device approval.

## Recommended browser path

```text
Browser → Tailscale Serve HTTPS → loopback Workhouse port
```

Use Serve HTTPS instead of exposing `http://100.x.y.z:3410`. The direct-IP
mode requires a different bind and origin policy and is not enabled by the
wizard.

## External-access wizard

Open **Settings → Server and execution devices → Main server → External
access**. The wizard detects the CLI version, daemon, login, connection,
MagicDNS, Serve, Funnel, and current configuration without changing them.

For an apply request it shows the fixed `tailscale serve` argv, loopback
target, exposure, administrator requirement, restart step, and rollback plan.
The browser cannot supply an executable, shell command, argv, or arbitrary
path. Approval binds a short-lived plan digest, configuration revision, and
detected-state revision.

Tailscale authentication compares the official `Tailscale-User-Login` Serve
header with one exact allowed email. The backend peer must be loopback and Host
and Origin must match the configured HTTPS URL. Funnel does not provide this
identity boundary and is detected only as an unsafe warning.

An existing Serve configuration not recorded as Workhouse-owned is never
overwritten or removed. Complete account login, device approval, and ACL work
in Tailscale. Restart Workhouse separately after applying the authentication
configuration, then run the wizard's connection tests again.

For Workers, join the same tailnet and connect to the approved server address;
do not route Worker WSS through an interactive Cloudflare Access login page.

Previous: [Installation](index.en.md) · Next: [Connectivity troubleshooting](connectivity-troubleshooting.en.md) · [Compare Cloudflare](cloudflare.en.md) · [Guidebook](../guide.en.md)
