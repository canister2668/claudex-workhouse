# Provider 認証方式

[言語案内](provider-authentication.md) · [English](provider-authentication.en.md) · [한국어](provider-authentication.ko.md)

前へ: [接続トラブルシューティング](install/connectivity-troubleshooting.ja.md) · [ガイドブック](guide.ja.md) · 次へ: [セキュリティ →](security.ja.md)

Claudex Workhouse は、異なる実行バックエンドを通じて6つの Provider を
サポートします。Codex と Claude は公式ランタイム、Gemini は Antigravity
エージェントまたは Vertex AI、DeepSeek と Ollama は設定済み API
エンドポイント、Grok は設定済み CLI ランタイムと xAI ログインを使用します。これらの認証境界を一つの共有認証情報システムへ
統合することはありません。

## Claude Code へのログイン

Claude のサブスクリプション、Console、または組織 SSO でログインする場合、
Workhouse は設定された公式 `claude` バイナリを疑似端末上で次のいずれかの
コマンドにより起動します。

```text
claude auth login
claude auth login --console
claude auth login --sso
```

Workhouse に表示されるログイン URL は CLI が出力したもので、HTTPS を使用する
許可済みの Claude ホストだけを受け入れます。公式ページにワンタイム認証コードが
表示された場合、そのコードは CLI の端末入力へ渡すためだけにローカルの
Workhouse サーバーを一度通過します。コードの原文は Workhouse のデータベースや
監査ログには保存されません。認証の冪等性情報はリクエストハッシュとしてメモリ内に
のみ保持され、認証情報を含む可能性がある端末の生出力も helper の外へ公開されません。

OAuth の交換と、得られた認証情報の保存・管理は公式 Claude Code CLI が行います。
Workhouse は `claude auth status` で接続状態を確認し、`claude auth logout` で
ログアウトしますが、Claude Code の認証情報ファイルを読みません。既存セッションを
検出するために `~/.claude/projects` 配下のプロジェクト会話履歴を読む場合がありますが、
これは認証情報へのアクセスとは別です。

## 認証済みリクエスト

Claude の作業は `claude -p`、`--output-format stream-json`、`--resume` などの
公式 CLI オプションで実行されます。Provider へのネットワークリクエストを構成し
認証するのは Workhouse の Web サービスではなく CLI です。Workhouse が Anthropic
API の認証ヘッダーを直接追加したり、Claude Code の OAuth トークンを独自の HTTP
クライアントで再利用したりすることはありません。

運用者が実行環境にすでに設定している認証情報には、Claude Code 自身の認証優先順位が
適用されます。既存の `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、クラウド Provider
設定、またはカスタム credential helper がサブスクリプションログインより優先される
場合があります。Workhouse はこれらの値を生成せず、CLI の優先順位も変更しません。

Codex も同じ Provider 固有の境界に従います。ログインと認証済み呼び出しは、認証情報を
抽出して OpenAI API を直接呼び出す方式ではなく、公式 Codex app-server ランタイムを
通じて実行されます。

## Gemini、DeepSeek、Ollama、Grok

Gemini の Antigravity モードは、`agy` ランタイムが管理する Google アカウント
セッションを使用します。Workhouse はランタイムが提供する承認済み Google
ログインフローを中継できますが、生成された OAuth 情報を公開したり別の要求に
再利用したりしません。Gemini の Vertex モードは別の直接応答バックエンドです。
運用者がアップロードした Google Cloud サービスアカウント JSON は非公開の
ファイル権限で保存され、選択したプロジェクトとリージョンだけに使用されます。

Gemini の Vertex Agent モードは、同じサービスアカウントとプロジェクトで公式 Gemini CLI
を実行します。新しい認証情報ストアは作成せず、CLI 自身の状態は Antigravity の OAuth
ホームとは別のホームディレクトリに保持します。Vertex Agent の実行に Antigravity の
Google ログインは不要です。

DeepSeek は設定済み互換 API URL と秘密情報を使用します。Ollama は設定済みの
ローカルまたはリモートエンドポイントと任意のアカウント設定を使用します。
モデルカタログは各エンドポイントから動的に取得され、Codex や Claude の CLI
ログインとして表示されることはありません。

Grok は設定済み Grok CLI を使用します。Workhouse は device または Google OAuth ログインフローを開始し、許可済み HTTPS ログインホストだけを受け入れ、ランタイムのモデルカタログで準備状態を確認します。OAuth 情報を抽出せず CLI を実行し、現在の Grok ランタイムには外部 MCP サーバー設定を渡しません。

## 単一ユーザー境界

Claudex Workhouse は、信頼できる個人の単一ユーザー・セルフホスト環境を対象とします。
Provider の認証情報は Provider CLI を実行する OS ユーザーに属します。複数人が一つの
Provider アカウントを共有できるマルチユーザーサービスとして公開しないでください。
Cloudflare Access はリモートアクセスを保護できますが、Workhouse をユーザー別の
アカウント分離システムに変えるものではありません。

この文書は実装上の境界を説明するものであり、法的見解または Provider 規約に関する
保証ではありません。運用者は自身の Provider アカウントとデプロイに適用される規約を
遵守する責任があります。

## 公式資料

- [Claude Code の認証](https://code.claude.com/docs/en/authentication)
- [Claude Code をプログラムから実行](https://code.claude.com/docs/en/headless)
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
