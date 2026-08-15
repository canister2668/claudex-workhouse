# セキュリティ

[English](security.en.md) · [한국어](security.ko.md) · [日本語](security.ja.md)

前へ: [Provider 認証](provider-authentication.ja.md) · [ガイドブック](guide.ja.md) · 次へ: [デプロイと運用 →](deployment.ja.md)

## 境界

- サーバーは `127.0.0.1:3410` のみにバインドし、NAS インターフェースや外部ポートを開きません。
- 固定 `projectId` だけを受け入れます。パスはサーバー側で解決し、起動時とタスク作成直前に正確な `realpath` を確認します。
- Provider コマンドは `spawn(binary, args, { shell: false })` を使います。Workspace file API は既存の realpath、symlink、サイズ、Git metadata 検査を維持しますが、名前が機密らしいという理由だけでは拒否しません。
- リクエスト本文は 64 KiB、prompt は 20,000 文字に制限し、コマンド時間と出力にも上限があります。
- 変更要求には same Origin、存在する場合の `Sec-Fetch-Site`、`X-Claudex-Workhouse-Request: 1`、UUID 冪等性キーが必要です。
- 一般リクエストは毎分 120 回、タスク作成は毎分 6 回に制限します。
- CSP、`frame-ancestors 'none'`、nosniff、no-referrer、permissions policy、API `no-store` を有効にします。
- Service Worker は app shell だけを cache し、`/api` 内容、task log、token、結果は cache しません。
- SSE には通常の Access 識別、正確な許可 Origin、有効 Project 内の所有 task、接続上限（全体 8、task ごと 3）が必要です。応答は `no-store`、proxy buffering 無効で、app-server socket を公開しません。
- Stream spool は追記前に sanitize し、`data/stream-events`（`0700`）下へ `0600` で保存し、8 MiB でローテーションして 24 時間保持します。Authorization header、OAuth token、API key、password、private key、JWT、環境変数代入などの secret は `[REDACTED]` に置換します。
- Task の結果・エラー・log と自動診断 metadata は SQLite 保存前に sanitize します。Worker 状態ファイル、audit detail、HTTP error、task/runtime/collaboration SSE、Desktop Worker relay も同じ sanitizer を使い、失敗時は原文ではなく値を省略します。
- Fastify log は Access JWT、cookie、authorization header を伏せ、handler error を sanitize します。認証 URL とワンタイムコードは認証済み専用 login event に限定し、通常 task event や audit へコピーしません。
- Agent event metadata は JSON object かつ sanitize 後 8 KiB 以下です。Secret-like key/value、bearer/JWT、環境変数代入、private-key block はブラウザ送信前に伏せます。通常の hash、UUID、task/thread ID、パスなどは保持します。
- 自動 handoff patch は既知の secret-like ファイル名を除外し、handoff 全体は失敗させません。Manifest は除外数だけを記録します。ユーザーが明示的に開く、編集する、download するファイルは遮断・伏字化しません。
- 認証済み設定から、対応 Provider 用の外部 HTTP MCP エンドポイントを登録できます。リモート URL は HTTPS 必須（HTTP は localhost のみ）で、各項目は許可済みの読み取り専用 role に割り当て、外部ツールが読み取り専用であることを運用者が確認します。Workhouse は外部サーバーコードをインストール・検査せず、サーバーが書き込み可能ツールを誤って表示することを技術的には防げません。Bearer token は secret として保存し、設定フォームへ再表示しません。Grok にはこの設定を渡しません。
- 内蔵 Emotion MCP は loopback peer だけを許可し、Cloudflare proxy request を拒否します。artwork は不変の same-origin bundle で、書き込み状態は `data/emotion` に置きます。
- Codex model、effort、service tier、permission profile は Worker 起動直前に現在の app-server catalog で再検証します。`:danger-full-access` にはブラウザの明示確認も必要で、グローバル Codex 設定は書き換えません。
- Codex stop には記録済み PID、PGID、開始時刻、Worker marker、command 一致、または接続 cx job が必要です。外部 CLI/VS Code thread は persisted turn が active に見えても stop control を受けません。
- 完全削除は stop/archive と別です。UUID 冪等性キー、別の警告と明示同意、active Worker がないこと、transcript を含まない audit record が必要で、ファイルや Git history は戻しません。

## 認証

Production mode は Access team JWKS、正確な issuer、Application AUD、正確なメール `admin@example.com` で `Cf-Access-Jwt-Assertion` を検証します。Team Domain/AUD がなければ HTTP 503 で fail closed し、ブラウザ送信の email header は信頼しません。

Test 認証には `authMode=test`、`CLAUDEX_WORKHOUSE_TEST_MODE=1`、loopback peer、正確な test identity header の全てが必要です。DSM 起動タスクで test mode を使わないでください。

## 個人ユーザーの Provider 資格情報範囲

Claudex Workhouse は個人セルフホスト環境向けです。Claude Code、Codex、GitHub CLI、Git credential helper、OS credential store は Web identity ごとではなくホスト単位です。Provider process は実行ホストの OS ユーザーとログイン状態を使います。Cloudflare Access と Workhouse browser session が認証するのは Workhouse へのアクセスであり Provider account ではありません。

所有者によるローカル Provider 設定・認証ファイル、`.env`、Git 資格情報、SSH ファイルの直接閲覧・変更は制限せず、Provider CLI の `HOME`、`.claude`、`.codex` アクセスも変えません。互いに信頼しないユーザーへ一つのインストールを公開しないでください。実行ホストの Provider identity と filesystem authority を共有することになります。

Redaction は Provider output、error、log、persistence、event、diagnostics、自動 handoff への自動コピーを保護します。ユーザーが明示的に開いたファイル内容には意図的に適用しません。

## Claude stop の安全性

所有 job だけが stop を表示します。signal 前に PID、開始時刻、process group、Worker command、ランダム command marker を比較します。その process group へ TERM を送り、5 秒後にも同じ identity が残る場合だけ KILL を送ります。

## ACL

独立した DSM shared folder は `admin`、専用 service account、`administrators` にだけ明示的 full-access ACE を持ち、`everyone` ACE はありません。子ファイルはこれらだけを継承します。Synology ACL では POSIX mode が `777` と表示されても権限の基準ではありません。`storage-and-permissions.md` を参照してください。
