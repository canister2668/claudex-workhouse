# 第三者通知

この文書は [英語の THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) の日本語参考訳です。
翻訳と英語原文が異なる場合は、英語原文が優先されます。

Claudex Workhouse 自体には `AGPL-3.0-only` が適用されます。以下のコンポーネントは
別個の第三者著作物であり、それぞれのライセンスと著作権表示が引き続き適用されます。

正確な解決済みバージョンは `app/pnpm-lock.yaml` とリリース SBOM に記録されます。
`node_modules` を含むバイナリパッケージは、各パッケージが提供するライセンスと通知
ファイルを保持します。バンドル Worker パッケージは、バンドラーが実際に含めた依存関係の
ライセンスファイルと、再配布される Node.js ランタイムのライセンスを
`licenses/third-party/` にコピーします。

## 本番用 JavaScript 依存関係

| コンポーネント | ライセンス |
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

推移的なランタイム依存関係にも、各パッケージディレクトリに同梱されたライセンス
メタデータと通知ファイル、およびリリース SBOM に列挙された条件が適用されます。

## 同梱ランタイム

- Node.js は、Node.js ライセンスおよび Node.js に同梱されたコンポーネントのライセンスに
  基づき、Docker イメージとポータブル Windows パッケージで再配布されます。ランタイム自身の
  ライセンスファイルとリリース SBOM が基準となります。
- Windows ランチャーは Windows システム API を使用し、外部ランチャーフレームワークを
  同梱しません。

## Provider インターフェース

Claudex Workhouse は、別途インストールされた Codex および Claude Code ランタイムと連携します。
これらの製品と名称には、それぞれの所有者の条件が適用されます。Claudex Workhouse が連携用
インターフェースを実装しているという理由だけで、それらのソースコードやモデル資産が本リポジトリに
含まれるわけではありません。

## プロジェクトのアートワーク

`app/public` 配下の感情アバターとアプリケーションアイコンは、Canister が Claudex Workhouse の
ために制作した原著作物です。第三者コンポーネントではありません。

このアートワークは、プロジェクトのソースに適用される AGPL-3.0-only とは別に、クリエイティブ・
コモンズ 表示 4.0 国際ライセンス（CC BY 4.0）で提供されます。Canister をクレジットすれば、
商用利用を含めて誰でも自由に使用、改変、再配布できます。
<https://creativecommons.org/licenses/by/4.0/deed.ja>

`@lucide/svelte` が提供するインターフェースアイコンは、上表の ISC ライセンスが適用される
第三者著作物です。
