# Provider authentication

[Language index](provider-authentication.md) · [한국어](provider-authentication.ko.md) · [日本語](provider-authentication.ja.md)

Previous: [Connectivity troubleshooting](install/connectivity-troubleshooting.en.md) · [Guidebook](guide.en.md) · Next: [Security →](security.en.md)

Claudex Workhouse supports six Provider identities through different execution
backends. Codex and Claude use their official runtimes; Gemini uses either the
Antigravity agent or Vertex AI; DeepSeek and Ollama use configured API
endpoints; Grok uses its configured CLI runtime and xAI sign-in. Workhouse does not collapse these authentication boundaries into one
shared credential system.

## Claude Code login

For Claude subscription, Console, or organization SSO login, Workhouse launches
the configured official `claude` binary in a pseudo-terminal using one of the
following commands:

```text
claude auth login
claude auth login --console
claude auth login --sso
```

The login URL displayed by Workhouse comes from the CLI and is accepted only
when it uses HTTPS on an approved Claude host. If the official page shows a
one-time authorization code, that code passes through the local Workhouse
server solely to be forwarded to the CLI's terminal input. The raw code is not
written to the Workhouse database or audit log. Authentication idempotency is
kept in memory using a request hash, and raw terminal output that could contain
authentication material is not exposed by the helper.

The official Claude Code CLI performs the OAuth exchange and manages the
resulting credentials in its own credential store. Workhouse checks connection
state with `claude auth status` and logs out with `claude auth logout`; it does
not read Claude Code's credential file. It may read Claude Code project
transcripts under `~/.claude/projects` to discover existing sessions, which is
separate from credential access.

## Authenticated requests

Claude work is executed through the official binary with documented CLI options
such as `claude -p`, `--output-format stream-json`, and `--resume`. The CLI—not
the Workhouse web service—constructs and authenticates the provider network
requests. Workhouse does not add Anthropic API authentication headers or reuse
Claude Code OAuth tokens in its own HTTP client.

Environment credentials already configured by the operator remain subject to
Claude Code's own authentication precedence. In particular, an existing
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, cloud-provider configuration, or
custom credential helper may take precedence over subscription login. Workhouse
does not create these values and does not override that CLI behavior.

Codex follows the same provider-native boundary: login and authenticated calls
are performed through the official Codex app-server runtime rather than by
extracting credentials for direct OpenAI API calls.

## Gemini, DeepSeek, Ollama, and Grok

Gemini Antigravity mode uses the Google-account session managed by the `agy`
runtime. Workhouse can relay the runtime's approved Google sign-in flow but
does not expose or reuse the resulting OAuth material. Gemini Vertex Direct mode
is a separate direct-response backend: the operator uploads a Google Cloud
service account JSON, which Workhouse stores with private file permissions and
uses only for the selected project and location.

Gemini Vertex Agent mode runs the official Gemini CLI with that same service
account and project. It adds no second credential store, and it keeps the CLI's
own state in a home directory separate from the Antigravity OAuth home. A Vertex
Agent turn never requires an Antigravity Google sign-in; being asked for one
means the backend is misconfigured.

DeepSeek uses the configured compatible API URL and secret. Ollama uses the
configured local or remote endpoint and optional account settings. Their model
catalogs are discovered from those endpoints; neither is presented as a Codex
or Claude CLI login.

Grok uses the configured Grok CLI. Workhouse can start its device or Google OAuth login flow, accepts only approved HTTPS login hosts, checks readiness through the runtime's model catalog, and invokes the CLI without extracting its OAuth material. External MCP server settings are not passed to the current Grok runtime.

## Single-user boundary

Claudex Workhouse is intended for one trusted operator in a personal,
self-hosted environment. Provider credentials belong to the operating-system
user that runs the provider CLI. Do not expose one installation as a shared
multi-user service that allows several people to use one provider account.
Cloudflare Access may protect remote access, but it does not turn Workhouse into
a multi-user account-isolation system.

This document describes the implementation boundary; it is not a legal opinion
or a guarantee about provider terms. Operators remain responsible for the terms
that apply to their provider account and deployment.

## Official references

- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
