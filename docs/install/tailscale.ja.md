# Tailscale で接続する

[ガイドブック](../guide.ja.md) · [English](tailscale.en.md) · [한국어](tailscale.md)

Tailscale は個人のスマートフォンや PC から Workhouse へ接続するための
推奨 private 経路です。Workhouse はアカウント作成、パスワード、再利用可能な
auth key、ACL、デバイス承認を管理しません。

## 推奨ブラウザー経路

```text
Browser → Tailscale Serve HTTPS → loopback Workhouse port
```

`http://100.x.y.z:3410` を公開する代わりに Serve HTTPS を使用します。
直接 IP 方式には別の bind と Origin policy が必要で、wizard は有効化しません。

## 外部アクセス wizard

**設定 → サーバーと実行デバイス → メインサーバー → 外部アクセス**を開きます。
CLI version、daemon、login、接続、MagicDNS、Serve、Funnel、現在の設定を
変更せずに検出します。

適用前に固定 `tailscale serve` argv、loopback target、公開範囲、管理者権限、
再起動、rollback を表示します。ブラウザーは executable、shell command、
argv、任意 path を指定できません。承認は短時間で期限切れになる plan digest、
設定 revision、検出状態 revision に固定されます。

Tailscale 認証は Serve の公式 `Tailscale-User-Login` header と許可された
1件の email を完全一致で比較します。backend peer は loopback、Host と Origin
は設定済み HTTPS URL と一致する必要があります。Funnel はこの identity 境界を
提供しないため、危険な状態として検出・警告するだけです。

Workhouse 所有として記録されていない既存 Serve 設定は上書き・削除しません。
login、device approval、ACL は Tailscale で完了してください。認証設定の適用後は
Workhouse を別途再起動し、wizard の接続テストを再実行します。

Worker は同じ tailnet に参加し、承認済み server address へ接続します。
対話型 Cloudflare Access login を Worker WSS 経路には使用しません。

前へ: [インストール](index.ja.md) · 次へ: [接続トラブルシューティング](connectivity-troubleshooting.ja.md) · [Cloudflare と比較](cloudflare.ja.md) · [ガイドブック](../guide.ja.md)
