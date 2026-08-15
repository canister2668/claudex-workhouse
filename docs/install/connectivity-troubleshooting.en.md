# Connectivity troubleshooting

[Guidebook](../guide.en.md) · [한국어](connectivity-troubleshooting.md) · [日本語](connectivity-troubleshooting.ja.md)

Narrow a connection failure in this order:

```text
service/container → local health → host port → DNS/TLS
→ authentication boundary → HTML/API/manifest → SSE → Worker WSS
```

## The server page does not open

- Confirm the service or container is running.
- Request `/api/health/live` from the host.
- Check whether another process owns the selected port.
- Confirm that the external proxy targets the actual loopback listener.

## HTTP works but SSE disconnects

- Check proxy buffering, compression, and idle timeouts.
- Confirm the request uses the same authenticated browser session.
- Re-run the wizard test after Workhouse has restarted with the new external origin.
- An anonymous server-side probe reports SSE as requiring authenticated browser verification; it does not claim success from a redirect alone.

## Worker WSS fails

The browser UI has no general WebSocket endpoint. This section applies only to
the outbound Desktop Worker WSS connection.

- Make local HTTP health succeed first.
- Verify that the reverse proxy forwards WebSocket upgrade.
- In a same-Compose advanced setup, use the Workhouse service name as origin rather than `localhost`.
- Ensure that the Worker is not redirected to an interactive Access login page.

## Safe diagnostic sharing

Use **Settings → Server and execution devices → Download safe diagnostic
bundle**. It is allowlisted and excludes raw logs, host identifiers, emails,
absolute paths, and remediation payloads. Before sharing any separate capture,
remove owner-claim tokens, pairing codes, Worker credentials, Authorization and
Cookie headers, provider credentials, Cloudflare tokens, unnecessary full
paths, and emails.

Previous: [Tailscale](tailscale.en.md) or [Cloudflare](cloudflare.en.md) · Next: [Provider authentication](../provider-authentication.en.md) · [Guidebook](../guide.en.md)
