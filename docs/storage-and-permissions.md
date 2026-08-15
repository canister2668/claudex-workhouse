# Storage and Permissions

## Layout

```text
$CLAUDEX_WORKHOUSE_ROOT/app       source, build, dependencies
$CLAUDEX_WORKHOUSE_ROOT/bin       lifecycle command
$CLAUDEX_WORKHOUSE_ROOT/config    server and project allowlist
$CLAUDEX_WORKHOUSE_ROOT/data      SQLite and owned Claude state
$CLAUDEX_WORKHOUSE_ROOT/logs      rotating service log
$CLAUDEX_WORKHOUSE_ROOT/backups   protected backup copy
$CLAUDEX_WORKHOUSE_ROOT/docs      operations and security docs
$CLAUDEX_WORKHOUSE_ROOT/run       supervisor PID
```

The database is `$CLAUDEX_WORKHOUSE_ROOT/data/claudex-workhouse.sqlite`; SQLite creates `-wal` and `-shm` siblings while the service is running.

## Verified Synology ACL

The DSM-created independent shared folder and descendants contain these allow identities only:

- `admin`: full access
- dedicated service account: full access
- `administrators`: full access

There is no `everyone` ACE and no ordinary-user/group ACE. Child directories, normal files, SQLite DB, WAL, and SHM inherited that same set. Service-account create/read/modify/delete and WAL operation succeeded. No ACL mutation command was used by this implementation.

Synology ACL controls effective access even when POSIX mode displays `777`; assess `synoacltool -get` output and actual access rather than mode alone.

The old `/srv/legacy/claudex-workhouse` directory was inspected and left unchanged. It contains only empty scaffolding directories and was not deleted.
