# Security

Claudex Workhouse is designed for a single trusted operator. Keep the web listener on
loopback unless an authenticated reverse proxy such as Cloudflare Access is in
front of it.

Never commit local configuration or runtime state. The repository ignores
`config/*.json` except redacted examples, along with databases, logs, backups,
uploads, snapshots, runtime files, environment files, archives, and private key
formats.

Before pushing changes, inspect the exact upload set:

```sh
git status --short
git diff --cached
git ls-files --cached --others --exclude-standard
```

If a credential was ever committed, rotate it first and remove it from Git
history before pushing. Making a repository private does not make committed
credentials safe.

Report security issues privately to the repository owner.
