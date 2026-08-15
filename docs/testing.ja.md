# テスト

[English](testing.en.md) · [한국어](testing.ko.md) · [日本語](testing.ja.md)

前へ: [デプロイ](deployment.ja.md) · [ガイドブック](guide.ja.md) · 次へ: [既知の制限 →](known-limitations.ja.md)

## 自動テスト

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm check
pnpm test
pnpm build
pnpm test:e2e:docker
```

`test:e2e:docker` は既に動作中の `http://127.0.0.1:3410` に対し、バージョン固定 Playwright image でテストするため DSM に GTK/ATK browser library は不要です。通常の Playwright 引数は `--` の後へ渡します（例: `pnpm test:e2e:docker -- --project=mobile-360`）。対象の変更には `CLAUDEX_WORKHOUSE_E2E_BASE_URL` を使います。


Vitest は正確な Project allowlist、path escape 拒否、output sanitization、cx JSON 成功・失敗 contract、SQLite WAL/SHM、task persistence、idempotency claim を網羅します。Playwright は 360x800、412x915、800x1280 の list/detail/modal/PWA flow と横 overflow を確認します。

Streaming fixture は Codex/Claude message delta、command output、file-change lifecycle、web search、terminal event、stop、server restart replay、`Last-Event-ID`、誤 Origin／未認証の拒否、task ごとの接続上限、mobile delta batching、service-worker 除外を検証します。

Screenshot は `app/test-results` に保存します。Test 認証は loopback test server で `CLAUDEX_WORKHOUSE_AUTH_MODE=test CLAUDEX_WORKHOUSE_TEST_MODE=1` の場合だけ有効です。

## 統合結果

- Codex: create、pending registration、list/detail、thread 指定 follow-up、noninteractive fork、targeted stop、browser/server disconnect survival が成功しました。
- Claude 所有 task: create、session ID capture、detail、resume、fork、process identity 検査 stop が成功しました。
- Claude external: list/detail は成功し、stop は設計通り拒否されました。
- 同じ UUID の create は cx job と永続応答を一つずつだけ作りました。
- Workhouse server restart 後も active cx Worker は生存し、回復 task を表示・停止できました。
- Fastify child だけを kill すると server PID だけが変わり、supervisor PID と cx core check 14 件は維持されました。既存 dead-broker check 5 件は引き続き失敗します。

### Codex フルセッション fixture（2026-07-11）

- App-server metadata pagination で native `cli`/`vscode` を含む非 archive thread 721 件を index しました。
- 既存 Codex row は検証済み `claudex-workhouse` 8 件と `external-cx` 5 件へ migration されました。
- Detached Worker create、restart survival、transcript turn paging、external CLI/VS Code resume・fork が成功しました。
- Parent archive/unarchive は fork child に影響せず、parent delete も child を削除しませんでした。再 delete は native not-found でした。
- Running Worker delete は 409、検証済み Worker stop は 200、stop 後 delete は 200 でした。
- Fixture では `gpt-5.4/high/priority` が受理され、未対応 Fast/effort/permission 組み合わせは拒否されました。Runtime が報告しないため effective setting は unknown でした。
- 破壊的 fixture は名前または最初の prompt の `CLAUDEX_WORKHOUSE_FIXTURE_20260711` で識別します。
- Claude regression fixture `dc1dfc2a-6dca-48cf-a75c-8b3c81fb2cb2` は create/resume が成功し、fork `7082a5f9-a8f0-4840-a684-9b0df81a74cd` を作り、external stop は HTTP 403 でした。Claude history-delete UI がないため transcript は残っています。

## 失敗条件の検査

未認証、誤 Origin、mutation guard 欠落、不明 Project/task、不正 ID、空／過大 prompt、再利用 idempotency key、external Claude stop、cx job JSON 欠落、Access 設定欠落を検証しました。Create timeout は再試行せず、pending task は実状態または `unknown` へ収束します。
