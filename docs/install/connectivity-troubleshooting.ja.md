# 接続トラブルシューティング

[ガイドブック](../guide.ja.md) · [English](connectivity-troubleshooting.en.md) · [한국어](connectivity-troubleshooting.md)

次の順序で接続障害を切り分けます。

```text
service/container → local health → host port → DNS/TLS
→ 認証境界 → HTML/API/manifest → SSE → Worker WSS
```

## Server page が開かない

- service または container が実行中か確認します。
- host から `/api/health/live` を要求します。
- 選択した port を別 process が使用していないか確認します。
- 外部 proxy が実際の loopback listener を指しているか確認します。

## HTTP は動くが SSE が切断される

- proxy buffering、compression、idle timeout を確認します。
- 同じ認証済み browser session からの要求か確認します。
- 新しい external origin を読み込むため Workhouse を再起動してから wizard test を再実行します。
- 匿名 server probe は SSE を認証済み browser の確認待ちとして報告し、redirect だけで成功とはしません。

## Worker WSS が失敗する

Browser UI は一般 WebSocket endpoint を公開しません。この節は送信専用
Desktop Worker WSS 接続だけに適用されます。

- 先に local HTTP health を成功させます。
- reverse proxy が WebSocket upgrade を転送するか確認します。
- 同一 Compose の高度な構成では `localhost` ではなく Workhouse service name を origin にします。
- Worker が対話型 Access login page へ redirect されていないか確認します。

## 安全な診断情報の共有

**設定 → サーバーと実行デバイス → 安全な診断 bundle をダウンロード**を
使用します。allowlist 方式で raw log、host ID、email、絶対 path、remediation
payload を含みません。別の画面や log を共有する場合も owner-claim token、
pairing code、Worker credential、Authorization/Cookie header、Provider credential、
Cloudflare token、不要な完全 path と email を削除してください。

前へ: [Tailscale](tailscale.ja.md) または [Cloudflare](cloudflare.ja.md) · 次へ: [Provider 認証](../provider-authentication.ja.md) · [ガイドブック](../guide.ja.md)
