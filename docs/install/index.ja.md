# Claudex Workhouse のインストール

[ガイドブック](../guide.ja.md) · [English](index.en.md) · [한국어](index.md)

**メインサーバーは Linux または Linux ベース NAS の Docker で構成します。**
現在リリースしている経路はこれだけです。**Windows 対象はすべて開発中であり、
リリースしていません** — portable サーバー、ネイティブ Worker、Docker Desktop +
Worker のいずれもです。Windows では Linux host または NAS にメインサーバーを置き、
ブラウザー（PWA）から利用してください。

| 対象 | メインサーバー | Worker | 推奨方式 |
|---|---|---|---|
| Synology DSM 7 | 対応 | 任意 | Docker Compose |
| Linux x64/arm64 | 対応 | 対応 | Docker Compose または current-user Worker |
| その他の Docker NAS | 一般 Docker 手順 | 任意 | Docker Compose |
| Windows 11 x64 | **開発中** | **開発中** | 未リリース・ブラウザーから利用 |

Windows に残る課題は
[Windows サポート方針](../windows-support-policy.md)にまとめています。

## インストール順序

1. デバイスと保存場所を選択します。
2. manifest と署名を検証したリリースをダウンロードします。
3. NAS/Linux host で `install.sh` を実行し、owner-claim URL を開きます。
4. Provider runtime を接続し、組み込み診断を完了します。
5. **設定 → サーバーと実行デバイス → メインサーバー → 外部アクセス**を開きます。
6. [Tailscale](tailscale.ja.md) または [Cloudflare Tunnel と Access](cloudflare.ja.md) を選び、変更計画を確認して適用・接続テストを実行します。

installer は NAS 管理者パスワード、SSH private key、Provider credential、
Docker socket 権限を要求しません。権限が必要な作業は管理者の別操作として表示します。

## プラットフォームガイド

- [Docker](../docker.ja.md)
- [デプロイと NAS 自動起動](../deployment.ja.md)
- [Desktop Worker](../desktop-worker.ja.md)
- 韓国語の詳細手順: [Synology](synology.md)、[Linux](linux.md)、[Node インストール (npm)](node.md)、[Windows Docker Desktop + Worker](windows.md)（開発中）、[Windows Worker](windows-worker.md)（開発中）、[ローカルネットワーク](local-network.md)

リリースは固定されていない `latest` tag ではなく署名済み manifest から
選択します。署名、期限、downgrade の検証失敗時はインストールを停止します。
[リリース検証](../release/verification.md)も参照してください。

前へ: [概要](../introduction.ja.md) · 次へ: [Tailscale](tailscale.ja.md) または [Cloudflare Tunnel と Access](cloudflare.ja.md) · [ガイドブック](../guide.ja.md)
