# Cloudflare Tunnel と Access

[ガイドブック](../guide.ja.md) · [English](cloudflare.en.md) · [한국어](cloudflare.md)

Cloudflare は任意です。基本範囲は運用者が作成した Tunnel と Access
application の接続・診断です。wizard は Workhouse 所有の token-file と
host/sidecar 起動ファイルも生成できます。アカウントパスワードやアカウント
全体権限の API token は要求しません。

## 既存 host tunnel

```text
Browser → Cloudflare Access → Cloudflare Tunnel
        → http://127.0.0.1:3410 → Workhouse
```

Docker の公開 port は `127.0.0.1:3410:3410` のように loopback に限定します。
Access のない Tunnel は管理 UI を公開する可能性があるため、wizard は到達性と
認証保護を別々に検査します。

## 管理 host または sidecar ファイル

管理 mode は Tunnel token を `config/external-access/cloudflared.token` に
`0600` で保存します。command argument、API response、SQLite、audit detail、
support output には保存しません。生成 Compose fragment は Docker socket を
mount しません。plan に表示された固定 operator command を確認して実行します。

Workhouse 所有でない service、route、credential JSON、config は上書き・削除
しません。同一 Compose の高度な構成では `localhost` ではなく Workhouse の
service name を origin にします。標準生成 sidecar は loopback origin を保つため
host network を使用します。

## Wizard の順序

1. host executable、process/service、Docker container、credential mode、安全な config 候補を検出します。
2. 既存構成の検証、管理 host、管理 sidecar を選択します。
3. HTTPS hostname、Access team domain、application AUD、完全一致 email、管理 mode の場合だけ Tunnel token を入力します。
4. 公開範囲、認証境界、ファイル、固定 operator command、再起動、rollback を確認します。
5. Workhouse 所有ファイルだけを適用します。
6. local health、DNS、TLS、匿名 Access 境界、HTML、API、manifest、Origin 一致を検査します。
7. 認証済み browser で再検査し、URL と QR code を表示します。

匿名 redirect は Access 境界の存在を示すだけで、特定の exact-email policy の
正しさまでは証明しません。Zero Trust で policy と Tunnel route を確認し、
認証変更を読み込むため Workhouse を再起動して SSE/PWA を再検査します。

QR code には URL だけを含め、Tunnel token、Access cookie、Worker credential
は含めません。Worker は通常 local network または Tailscale を使用します。

前へ: [インストール](index.ja.md) · 次へ: [接続トラブルシューティング](connectivity-troubleshooting.ja.md) · [Tailscale と比較](tailscale.ja.md) · [ガイドブック](../guide.ja.md)
