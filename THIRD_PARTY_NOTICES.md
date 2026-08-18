# Third-Party Notices

Claudex Workhouse itself is licensed under `AGPL-3.0-only`. The components
below are separate third-party works and remain under their own licenses and
copyright notices.

Exact resolved versions are recorded in `app/pnpm-lock.yaml` and release SBOMs.
Binary packages that include `node_modules` retain the package license and
notice files supplied by those packages.
Bundled Worker packages copy the license files for the dependencies actually
included by the bundler into `licenses/third-party/`, together with the
redistributed Node.js runtime license.

## Production JavaScript dependencies

| Component | License |
| --- | --- |
| `@fastify/multipart` | MIT |
| `@fastify/rate-limit` | MIT |
| `@fastify/static` | MIT |
| `@fastify/websocket` | MIT |
| `@lucide/svelte` | ISC |
| `@modelcontextprotocol/sdk` | MIT |
| `better-sqlite3` | MIT |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `fastify` | MIT |
| `jose` | MIT |
| `marked` | MIT |
| `qrcode` | MIT |
| `web-push` | MPL-2.0 |
| `ws` | MIT |
| `zod` | MIT |

Their transitive runtime dependencies are likewise governed by the license
metadata and notice files shipped in their package directories and enumerated
by the release SBOM.

## Bundled runtimes

- Node.js is redistributed in the Docker image and portable Windows packages
  under the Node.js license and the licenses of components bundled with Node.js.
  The runtime's own license files and release SBOM are authoritative.
- The Windows launcher uses Windows system APIs and does not vendor an external
  launcher framework.

## Provider interfaces

Claudex Workhouse interoperates with separately installed Codex and Claude Code
runtimes. Those products and their names are governed by their respective
owners' terms. Their source code and model assets are not included in this
repository merely because Claudex Workhouse implements an interface to them.

## Project artwork

The emotion avatars and application icons under `app/public` are original works
created by Canister for Claudex Workhouse. They are not third-party components.

That artwork is released under the Creative Commons Attribution 4.0
International license (CC BY 4.0), separately from the AGPL-3.0-only license
that governs the project source. Anyone may reuse, modify, and redistribute it,
including commercially, as long as Canister is credited.
<https://creativecommons.org/licenses/by/4.0/>

Interface icons supplied by `@lucide/svelte` remain third-party works under the
ISC license shown above.
