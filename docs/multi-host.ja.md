# マルチホスト実行構成

[English](multi-host.en.md) · [한국어](multi-host.ko.md) · [日本語](multi-host.ja.md)

Claudex Workhouse は NAS を不変の `local` 実行ホスト、ペアリング済みコンピューターを `worker` ホストとして扱います。Project は論理名、Workspace は一つのホスト上でその Project に属する検証済みディレクトリです。Provider セッションは常に Provider、ホスト、Workspace に帰属します。古いリクエストに `executionHostId`/`workspaceId` がなければ従来の NAS マッピングへ解決します。

## 信頼境界

- ブラウザの変更要求には Cloudflare Access、same-origin、`X-Claudex-Workhouse-Request: 1`、UUID 冪等性キー、rate limit が必要です。
- `/worker/*` はブラウザ Cookie や Cloudflare ユーザー識別を使いません。ペアリングは有効期間 10 分のワンタイムコードを使い、接続 Worker は 256 ビット資格情報から導出したキーでランダム challenge に応答します。
- サーバーが保存するのは資格情報由来のハッシュだけです。Worker は原本を OS ユーザー設定へ `0600` で保存します（Windows は現在ユーザー ACL）。
- Cloudflare サービストークンヘッダーは Worker 環境変数から転送ゲート用途にだけ指定でき、Worker の識別には使えません。
- プロトコルは固定の typed command だけを許可します。shell、実行ファイル、argv RPC はありません。Prompt と Markdown は Provider 入力またはファイルとしてだけ渡され、shell で解釈されません。
- 各メッセージは接続 generation と増加 sequence を持ちます。新しい認証済み接続が古い generation を置き換え、サイズは 1 MiB に制限されます。

## Workspace 境界

ローカル Root は `config/claudex-workhouse.json` の `workspaceRoots` から取得します。未設定ならインストールルート下に `workspaces/` を作成します。その外側にある既存 Project には正確なパスだけを登録できる Root を与え、広い親ディレクトリを暗黙に信頼しません。

Worker Root はローカル Worker CLI からだけ追加できます。Web UI は既存 Root を選べますが新しい絶対パスは送信できません。ディレクトリ参照は HMAC 署名付き entry ID を返します。登録・作成時に lexical containment と `realpath` を再検査し、symlink をたどりません。Windows も同じ real-path containment と予約名拒否を適用します。junction/reparse point はリリース前に実機 Windows で検証が必要です。

Git clone は HTTPS またはホスト設定済み SSH のみを許可し、`protocol.file.allow=never`、`protocol.ext.allow=never`、`shell:false` を強制し、追加 Git 引数を受けません。失敗時はその clone 用に作成した空ディレクトリだけを削除します。

## リモートタスクの収束

Worker はローカルと同じコンパイル済み Claude/Codex runner を起動します。タスク状態と 8 MiB/24 時間 NDJSON event spool は Worker OS ユーザー領域に置かれます。切断時、サーバーはホストを offline、活動中タスクを最終状態付き `unknown` と表示し、failed にはしません。再認証後、Worker が authoritative snapshot と未送信 event ID を送り、サーバーは古い generation を拒否して最近の event ID を重複排除します。

所有プロセスは marker とプラットフォーム固有のプロセス識別で記録します。Linux は PID、開始時刻、実行ファイル、コマンドライン、process group、macOS は PID、開始時刻、所有 marker、Windows は PID、CIM 作成時刻、実行ファイル、command marker を検査してから process-tree stop を許可します。外部 CLI/VS Code プロセスは表示だけで、Worker コマンドから停止しません。

## Handoff と WorkChain

Handoff はプロセスメモリや Provider セッション ID を移動しません。新しい対象セッションを作り、`WorkChain` 内に `SessionLink` を保存します。

Artifact は Project ごとの `data/handoffs/<project>/<artifact>/` に保存します。ディレクトリは `0700`、ファイルは `0600` で、決定的な `handoff.md`、checksum 付き非実行 `manifest.json`、任意の最大 8 MiB `git diff --binary` patch からなります。

リモート patch の生成・転送には checksum 検証済み 512 KiB typed chunk を使い、メッセージを 1 MiB 以下にします。Worker が読めるのは登録 Workspace で直前に自身が生成した patch だけで、汎用ダウンロード RPC ではありません。

Patch は自動適用しません。secret-like なファイル名があれば生成を停止します。対象検証では Project、ホスト可用性、Git remote/commit、dirty 状態、活動中 Workspace lease を比較します。Commit 不一致で checkout、pull、branch 変更は行いません。Continue handoff は source write lease を解放して target write lease を取得し、review は read lease を取得します。Artifact は 7 日で期限切れとなり、内容や patch byte は audit へコピーしません。

## 運用上の注意

- Provider 認証は実行ホストごとに独立し、ホスト間でコピーしません。
- 複数の Web ビューアーは各ホスト OS ユーザーの Provider アカウントを共有します。マルチテナント分離ではありません。
- Worker が offline の間は現在のタスク状態や停止結果を確認できません。
- 「Workspace の登録解除」は DB マッピングだけを削除し、ファイルは残します。
- ディスク削除は別操作で、Root ごとに既定無効、active/unknown タスク中は禁止、Workspace 名の再入力が必要です。
- Provider をまたぐ review は選択した handoff 資料と関連コード文脈を別 Provider へ送ります。
- リモート Provider 状態はホスト診断で確認できます。ログインはそのホストの公式 CLI で行えます。未検証 Worker プラットフォームでリモートログインブリッジを有効にしないでください。
