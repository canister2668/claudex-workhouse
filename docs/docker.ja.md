# Docker インストール

[English](docker.en.md) · [한국어](docker.ko.md) · [日本語](docker.ja.md)

メインサーバーには Linux または Linux ベース NAS の Docker host を推奨します。
以下の Windows 手順は Linux host を利用できない場合の代替です。

Windows 11 x64 の既定経路は、Docker Desktop のメインサーバーと
current-user Windows Worker の組み合わせです。インストールページの
**Windows + Docker Desktop** から、署名済み manifest と正確な image
digest に固定された PowerShell を取得します。コンテナは Web UI と DB を
実行し、Worker は Windows ユーザーの Claude Code・Codex ログインとローカル
Workspace アクセスを保持します。[Windows 手順](install/windows.md)も参照してください。

1. `.env.example` を `.env` にコピーし、外部 URL を設定します。
2. `docker compose up -d --build` で起動します。
3. セキュリティのため、既定のポートは `127.0.0.1` のみにバインドされ、`local` 認証はループバック Origin でのみ動作します。外部公開の前に Cloudflare Access を設定し、`cloudflare` モードへ切り替えてください。
4. Claude Code と Codex のランタイムを認証情報と一緒にイメージへ組み込まないでください。公式インストールを `claudex-workhouse-runtime` ボリュームに配置するか、Desktop Worker を接続します。

コンテナは UID/GID 10001、capability なし、`no-new-privileges` で実行されます。Provider 認証は実行ホストごとに独立しており、別のホストへコピーされません。

設定、DB、ランタイム、ワークスペースはそれぞれ named volume に保持されます。起動時に `umask 077` が適用されるため、設定、Push キー、SQLite、WAL は `0600` で作成されます。既定の Compose ポートはループバックのみに公開され、`local` 認証もループバック Origin のみに許可されます。LAN またはインターネットへ公開する前に、`CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN` と Cloudflare Access、または検証済みのリバースプロキシ認証を設定してください。

リリースワークフローは amd64/arm64 イメージをビルドし、OCI provenance、SBOM、digest を公開します。ローカルビルドは `docker compose build`、起動確認は `docker compose up -d` と `/api/health/live` で行います。
