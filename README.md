# 108掲示板

Node.jsサーバー無し、HTML/CSS/JSのみの静的サイト。データ・認証・画像保存は全部Supabase任せ。GitHub Pagesにそのまま置いて動く。

## セットアップ（最初の1回だけ）

1. Supabaseでプロジェクトを作る
2. SQL Editorで `db/schema.sql` を丸ごと実行（再実行しても壊れない作りなので、更新時も同じ手順でOK）
3. Authentication → Users で管理者アカウントを1人だけ作成（メール・パスワードは自分用）
4. Project Settings → API の Project URL / anon public key を `public/supabase-config.js` に貼る
5. 画像削除をサーバー側だけで行うため、service_roleキーをVaultに登録する

   ```sql
   select vault.create_secret('service_roleキーをここに', 'post_images_service_role_key');
   ```

   実行したら忘れてOK。このコマンド自体はどこにも保存しない。

## ログイン

- 入場パスワード：108801（`gate.html`。これは荒らし避け程度のもので、実際の防御はRLS側）
- 管理者：`admin.html` を開いて、3で作ったアカウントのメール・パスワードでログイン

## 動作確認

`public` フォルダをVS CodeのLive Serverで開くだけ。

## 公開

このフォルダをGitHubリポジトリにして、Settings → Pages で `main` ブランチ・`/root` を指定。
リポジトリがPublicだと中身（コードやこのREADMEも）誰でも見られる状態になるので、外部に見せたくないなら非公開にする方法も検討。

## 制限

- BANはブラウザ単位（IPでの制御は無し）
- 連投対策はクライアント側の目安に加えて、サーバー側でも制限（スレ立て30秒・レス3秒・通報10秒に1回まで）
- 画像削除は本人か管理者のみ、サーバー側で判定してから実行

## 機能

匿名ID自動付与、いいね、ブックマーク、1000到達で過去スレ化、通報→管理者対応、本人は自分の投稿のみ削除可、管理者は全操作可。
