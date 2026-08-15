# Claudex Workhouse Desktop Worker

[English](desktop-worker.en.md) · [한국어](desktop-worker.ko.md) · [日本語](desktop-worker.ja.md)

Worker には Node.js 20 以降が必要です。プラットフォーム共通パッケージとして Windows x64、Linux x64/arm64、macOS arm64 をサポートします。現在のデスクトップユーザーとして実行され、外向きの WSS 接続だけを開きます。

## Windows ポータブル UI（開発中・未リリース）

> Windows Worker はまだリリースしていません。フックの実行、Codex CLI の
> インストール、セッション進行状況の表示が安定して動作しないためです。
> 以下は開発用の参考情報です。
> [Windows サポート方針](windows-support-policy.md)を参照してください。

Claudex Workhouse サーバーでポータブルフォルダーと ZIP をビルドします。

```sh
cd app
pnpm run worker:portable
```

出力は `packages/claudex-workhouse-worker-windows-portable.zip` です。デスクトップで展開し、`Start Claudex Workhouse Worker.vbs` をダブルクリックします。ペアリングコマンドの入力は不要です。ローカル設定画面では次の機能を利用できます。

- Claudex Workhouse URL とワンタイムペアリングコードの入力
- Workspace Root のネイティブフォルダー選択
- 接続状態と自動起動状態
- Provider／ランタイム診断
- 切断とローカル設定

管理画面はランダムな `127.0.0.1` ポートにバインドされ、メモリ内だけの 256 ビットトークンを要求し、`no-store` 応答を返します。Worker の認証情報は公開されず、Worker 接続自体も外向き専用です。

ポータブル ZIP はデスクトップに Node.js 20 以降があることを前提とします。自己完結型の社内 ZIP を作る場合は、パッケージ時に `CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE` を信頼できる公式 Windows `node.exe` に向けてください。ランチャーの隣に格納されます。コード署名は別のリリース工程です。

## CLI のインストールとペアリング（上級）

サーバーでパッケージをビルドします。

```sh
cd app
pnpm run worker:pack
```

生成されたアーカイブをデスクトップへインストールします。Workhouse でグローバル設定 → 実行ホスト → 新しいデスクトップを開き、表示されたコマンドを実行します。

```sh
claudex-workhouse-worker pair --url https://agent.example.com --code ABCD-EFGH-IJKL --name Desktop-PC
```

グローバル npm インストール後は、`claudex-workhouse-worker-ui` で同じターミナル不要の設定画面を開けます。

Cloudflare Access が `/worker/*` も保護する場合、Worker プロセス環境に専用サービストークン `CF_ACCESS_CLIENT_ID` と `CF_ACCESS_CLIENT_SECRET` を設定します。このヘッダーは Edge のゲートを通過するだけで、Worker の識別には引き続き challenge 認証された Worker 資格情報を使います。

## Root と Provider ログイン

意図的に狭いプロジェクト Root をローカルへ追加してください。ドライブのルートやホームディレクトリ全体を登録しないでください。

```sh
claudex-workhouse-worker roots add "D:\Projects" --name Projects
claudex-workhouse-worker roots list
```

ディスク削除は既定で無効です。ローカル運用者が `--allow-delete` で Root ごとに明示的に許可し、Web UI でも名前を再入力する必要があります。タスクが実行中、または状態未確認の場合は削除を拒否します。

Worker を実行する同じ OS ユーザーで公式ツールにログインします。

```sh
claude auth login
codex login
```

Claudex Workhouse が読むのは公式の状態出力と App Server のアカウント状態だけで、認証ファイルを読んだりアップロードしたりしません。

現在の Worker パッケージはホストごとの認証状態を報告しますが、ログインはデスクトップ上の公式 CLI から直接開始します。NAS の Provider ログイン PTY／デバイスコードブリッジはリモート Worker 向けに一般化されていません。公開パッケージで NAS の接続ボタンがリモートホストへログインすると案内してはいけません。

## 実行とサービスのインストール

フォアグラウンドでは `claudex-workhouse-worker run`、現在ユーザーの自動起動には `claudex-workhouse-worker install-service` を使います。Windows は現在ユーザーのログオンタスク、Linux は `systemd --user`、macOS はユーザー LaunchAgent を使います。Unix での root サービスインストールは拒否されます。

## 診断、切断、削除

```sh
claudex-workhouse-worker status
claudex-workhouse-worker diagnose
claudex-workhouse-worker unpair
claudex-workhouse-worker uninstall-service
```

`unpair` はプロジェクトを残します。Workhouse 側でもホストを失効させてください。完全に削除するには、サービスを停止・削除し、ホストを失効させ、パッケージを削除した後、Worker 所有タスクが動いていないことを確認してから `~/.claudex-workhouse-worker` を削除します。

コピー用診断出力からは認証情報、Provider トークン、メール、環境変数全体、URL クエリを除外します。Root パスは表示名または basename に縮約されます。
