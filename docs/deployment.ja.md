# デプロイ

[English](deployment.en.md) · [한국어](deployment.ko.md) · [日本語](deployment.ja.md)

前へ: [セキュリティ](security.ja.md) · [ガイドブック](guide.ja.md) · 次へ: [テスト →](testing.ja.md)

## ビルド

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm install
pnpm check && pnpm test && pnpm build
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs restart
```

最初の `start` で Claude Code または Codex runtime がなければ、公式配布 endpoint からインストールします。既存の管理 binary は変更しません。外部 provisioner が両方を管理する場合だけ `CLAUDEX_WORKHOUSE_SKIP_RUNTIME_BOOTSTRAP=1` を設定するか、実行可能な `CLAUDEX_WORKHOUSE_CLAUDE_BIN` と `CLAUDEX_WORKHOUSE_CODEX_BIN` のパスを指定してください。

Production で test 認証環境変数を設定しないでください。Access 値の設定前は loopback service が fail closed で動作します。`/api/health/live` は使えますが、保護 API は setup-required を返します。

## NAS 再起動後の自動起動

Cloudflare Tunnel は `claudex-workhouse.example.com` を `http://127.0.0.1:3410` へ転送します。再起動後に Workhouse を始動するものがなければ loopback port に listener がなく、`cloudflared` は connection-refused、外部 URL は **HTTP 502 Bad Gateway** になります。そのため DSM boot task が必要です。

### Boot wrapper

raw manager ではなく wrapper で起動します。

```text
$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh
```

Wrapper は sudo/chmod/chown/synoacltool を使わず専用 DSM service account で実行され、次を行います。

- `HOME=$HOME` と `PATH=/usr/local/bin:/usr/bin:/bin` を設定
- `$CLAUDEX_WORKHOUSE_ROOT` が mount され書き込み可能になるまで既定 120 秒、3 秒間隔で待機
- `/api/health/live` が既に 200 なら二つ目の supervisor を作らず 0 で終了
- stale PID を掃除し重複 supervisor を作らない `claudex-workhouse.mjs start` に起動を委譲
- 起動後、既定 60 秒間 `/api/health/live` の 200 を待機
- Workhouse だけを起動し、`cx` broker/worker や Claude session へ signal を送らない
- `logs/claudex-workhouse-boot.log` に記録（supervisor と同じ 10 MiB × 4 rotation）

終了コードは `0` 正常、`10` volume 準備失敗、`11` manager start 失敗、`12` 起動後 health 200 未到達です。

### DSM タスクスケジューラ（管理者が手動設定）

`esynoscheduler.db` は root 所有なので、この手順だけは DSM UI で行います。DSM 内部 scheduler file を編集したり root task を作ったりしないでください。

コントロールパネル > タスクスケジューラ > **作成 > トリガーされたタスク > ユーザー定義スクリプト**:

- タスク名: `Claudex Workhouse Startup`
- ユーザー: application file を所有する専用 DSM service account
- イベント: `Boot-up`
- 実行コマンド: `$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh`

Wrapper を使わない fallback には volume wait と health gate がありません。

```text
/usr/local/bin/node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs start
```

作成後にタスクを選んで一度 **実行**し、確認します。

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status      # running supervisor=… bind=127.0.0.1:3410
curl -sS http://127.0.0.1:3410/api/health/live                    # {"ok":true,"status":"live"}
```

自動起動を削除するにはタスクスケジューラから `Claudex Workhouse Startup` を削除します。

## Log と health

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs logs
curl -sS http://127.0.0.1:3410/api/health/live
```

保護された完全な `/api/health` は SQLite、Codex、Claude、Access 設定も確認します。

## 更新

変更した source/config を先に backup し、build 完了後に Workhouse だけを restart します。Web process の失敗は自動再起動されます。通常の restart/stop は `cx` や Claude Worker process group を対象にしません。

### Claudex Workhouse本体の更新

グローバル設定 > システムの **Claudex Workhouseの更新** はProvider runtime
更新とは別です。ownerが確認したsigned stable releaseだけを適用できます。
実行中task、collaboration、maintenanceがある場合はブロックし、payload変更前に
検証済みSQLite/config snapshotを作成します。

Docker/NASではapp containerにDocker socketをmountせずhost-side updaterを
使います。Windows portableでは別process updaterを使い、rollback用に直前の
payloadを保持します。現在のWindows launcherはAuthenticode unsignedです。
信頼の根拠はsigned release manifest、正確なSHA-256、GitHub artifact
attestation、公開Defender結果です。Source checkoutは自動更新しません。

[release verification](release/verification.md) と
[key rotation](release/key-rotation.md) を参照してください。

### 管理 Claude Code runtime

Workhouse は `runtime/claude-bin/claude` を実行し、VS Code extension directory は検索しません。公式 Anthropic release manifest wrapper で管理します。

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs check latest
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs update latest
```

`update` は `downloads.claude.ai` だけから取得し、manifest version、artifact size、SHA-256、実行 version を検査して原子的に置換します。以前の実行ファイルは `backups/claude-runtime` に最新 4 個を保持します。管理 Worker では Claude 内部 auto-updater を無効にし、この検査と backup を迂回させません。Active Claude task が起動中でないとき、runtime 更新後に Workhouse を restart してください。

### 管理 Codex runtime と UI 更新

Workhouse は root 所有 npm fallback `/usr/local/bin/codex` と独立した公式 standalone を使います。Windows と Linux/NAS の両方で `runtime/codex-home/packages/standalone/releases/<version>-<target>/bin/codex[.exe]` の実ファイルを実行し、`current` や visible-bin symlink/junction を実行 path にしません。Active version は hash を記録した `runtime/codex-runtime.json` が選択するため、deploy runtime は DSM user home の package cache に依存しません。Codex 認証と native session history は Provider の通常 user home に残る user identity/state であり、Workhouse deployment file ではありません。

Avatar 状態は管理 Claude/Codex Worker の Provider stream event で駆動します。Deployment は `~/.claude/settings.json`、`~/.codex/hooks.json`、Project 設定へ lifecycle hook や Workhouse path を追加しません。

グローバル設定 > Runtime には両 Provider の **更新確認**があり、利用可能なら **更新**ボタンを表示します。Codex は全対応 OS で OpenAI 公式 release metadata と `codex-package_SHA256SUMS` を個別に検証し、両 digest が一致する package だけを version directory に展開して state file を原子的に切り替えます。Claude は `bin/claude-runtime.mjs` を使います。既存 Worker へ signal は送らず、新しい Codex app-server から更新 binary を使います。

Usage popover は隔離 safe-mode pseudo-terminal で Claude Code 公式 `/usage` を要求します。Workhouse は Claude credential file や未文書化の Anthropic consumer OAuth endpoint を読み書き・呼び出ししません。Probe は Python 3 標準 library だけを使い、parse 済み plan percentage と reset label だけを返し、terminal/account text は破棄します。
