# Supabase無料プラン初期設定

## 方針

MVP検証では、まずSupabase無料プランで親子データをクラウド同期する。
初期実装は `account_snapshots` にアプリ全体のJSONを保存する方式にして、親子の実機確認を優先する。

本番化前には、親・子ども・申請・ポイント履歴・おこづかい履歴を個別テーブルへ分ける。

## Supabase側

1. Supabaseで無料プロジェクトを作成
2. SQL Editorで `/supabase/schema.sql` を実行
3. Project Settings > API から以下を取得
   - Project URL
   - anon public key

## Vercel側

Project Settings > Environment Variables に以下を追加する。

```text
INCE_SUPABASE_URL=SupabaseのProject URL
INCE_SUPABASE_ANON_KEY=Supabaseのanon public key
```

追加後、Vercelで再デプロイする。

## アプリ側の確認

保護者ログイン後、設定画面の「クラウド保存」を確認する。

- 保存方式: Supabase
- 同期状態: 同期済み

この表示になれば、Supabase接続は有効。

## 注意

現在のRLSポリシーはMVP検証用に緩くしている。
URLとanon keyが公開される前提のため、本番化前にはSupabase Authを導入し、親アカウントごとのアクセス制御に変更する。

写真保存は無料枠を圧迫しやすいため、次の段階でStorage保存と画像圧縮を入れる。

## 実装メモ

現在のSupabase同期は、公開版との互換性を優先して `app/cloud.js` から有効化している。

- `localStorage` の `ince_parent_account` 変更時に `account_snapshots` へupsertする。
- 起動時にSupabase側の新しいスナップショットを取得する。
- `app/index.html` ではSupabase CDN、`config.js`、`app.js`、`cloud.js` を読み込む。
- `scripts/build.mjs` はVercel用に `config.js` を生成する。

注意: ローカルの `app/app.js` 側にもSupabase同期処理が入っている場合がある。GitHub公開版と統合する際は、同期処理を1系統に整理する。
