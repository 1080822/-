-- 匿名交流掲示板 データベース定義
-- Supabaseの「SQL Editor」にこの内容を貼り付けて実行してください（1回だけでOK）。
--
-- 設計方針:
--   Node.jsサーバーを使わず、ブラウザから直接Supabaseに接続するため、
--   「誰が何をしてよいか」のルールはすべてこのSQL側（RLS + 関数）で守ります。
--   - 一般の閲覧・投稿・いいね・通報 → 誰でも実行できる関数
--   - スレッド削除（自分の立てたスレッドのみ） → 関数内でトークンを照合
--   - レス削除・BAN・通報対応など → Supabase Authでログインした人（＝管理者）のみ実行可能
--     （このサイトには新規登録フォームが無いので、Supabase側でユーザーを1人作れば、
--      　その人だけが管理者になります）

-- ========== テーブル ==========

create table if not exists threads (
  id bigint generated always as identity primary key,
  title text not null,
  creator_id text not null,
  creator_token_hash text not null,
  created_at bigint not null,
  last_reply_at bigint not null,
  reply_count integer not null default 0,
  is_archived boolean not null default false,
  is_deleted boolean not null default false,
  thumbnail_path text
);

-- スレッド一覧に表示するサムネイル画像（新規スレッド作成時に選択・任意）
alter table threads add column if not exists thumbnail_path text;

create table if not exists replies (
  id bigint generated always as identity primary key,
  thread_id bigint not null references threads(id),
  number integer not null,
  author_id text not null,
  author_token_hash text not null,
  content text not null,
  created_at bigint not null,
  like_count integer not null default 0,
  is_deleted boolean not null default false,
  image_paths text[]
);

-- 画像を複数枚添付できるように、配列カラムに統一する。
-- （以前のバージョンで作った単数カラムimage_pathが残っていれば、中身を引き継いでから削除する）
alter table replies add column if not exists image_paths text[];
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'replies' and column_name = 'image_path'
  ) then
    update replies set image_paths = array[image_path]
    where image_path is not null and (image_paths is null or array_length(image_paths, 1) is null);
    alter table replies drop column image_path;
  end if;
end $$;

create table if not exists likes (
  reply_id bigint not null references replies(id),
  user_token_hash text not null,
  created_at bigint not null,
  primary key (reply_id, user_token_hash)
);

create table if not exists reports (
  id bigint generated always as identity primary key,
  thread_id bigint not null,
  reply_id bigint not null,
  reason text,
  reporter_token_hash text,
  created_at bigint not null,
  status text not null default 'pending'
);

create table if not exists bans (
  id bigint generated always as identity primary key,
  token_hash text,
  reason text,
  created_at bigint not null,
  active boolean not null default true
);

create index if not exists idx_threads_sort on threads(is_archived, is_deleted, last_reply_at desc);
create index if not exists idx_replies_thread on replies(thread_id, number);
create index if not exists idx_reports_status on reports(status);
create index if not exists idx_bans_active on bans(active);

-- ========== RLS（行レベルセキュリティ）==========
-- テーブルへの直接書き込みは禁止し、下の関数（RPC）経由だけに限定する。
-- 閲覧（SELECT）は掲示板として必要な範囲のみ許可する。

alter table threads enable row level security;
alter table replies enable row level security;
alter table likes enable row level security;
alter table reports enable row level security;
alter table bans enable row level security;

drop policy if exists threads_select on threads;
create policy threads_select on threads for select using (true);

drop policy if exists replies_select on replies;
create policy replies_select on replies for select using (true);

drop policy if exists likes_select on likes;
create policy likes_select on likes for select using (true);

-- 通報・BAN一覧は管理者（ログイン済み）だけが見られる
drop policy if exists reports_select on reports;
create policy reports_select on reports for select using (auth.role() = 'authenticated');

drop policy if exists bans_select on bans;
create policy bans_select on bans for select using (auth.role() = 'authenticated');

-- テーブルへの直接 insert/update/delete は誰にも許可しない（関数経由のみ）

-- ========== 内部ヘルパー関数 ==========

create or replace function is_banned(p_token_hash text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from bans where active = true and token_hash = p_token_hash
  );
$$;

create or replace function require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'admin_only';
  end if;
end;
$$;

-- ========== 一般ユーザーが使う関数 ==========

-- スレッド新規作成（最初のレスも同時に作る）
drop function if exists create_thread(text, text, text, text);
drop function if exists create_thread(text, text, text, text, text);
drop function if exists create_thread(text, text, text, text, text[]);
create or replace function create_thread(
  p_title text,
  p_content text,
  p_author_id text,
  p_author_token_hash text,
  p_image_paths text[] default null,
  p_thumbnail_path text default null
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id bigint;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if is_banned(p_author_token_hash) then
    raise exception 'banned';
  end if;
  if length(trim(p_title)) = 0 or (length(trim(p_content)) = 0 and (p_image_paths is null or array_length(p_image_paths, 1) is null)) then
    raise exception 'invalid_input';
  end if;

  insert into threads (title, creator_id, creator_token_hash, created_at, last_reply_at, reply_count, is_archived, is_deleted, thumbnail_path)
  values (left(trim(p_title), 100), p_author_id, p_author_token_hash, v_now, v_now, 1, false, false, p_thumbnail_path)
  returning id into v_thread_id;

  insert into replies (thread_id, number, author_id, author_token_hash, content, created_at, like_count, is_deleted, image_paths)
  values (v_thread_id, 1, p_author_id, p_author_token_hash, left(trim(p_content), 2000), v_now, 0, false, p_image_paths);

  return v_thread_id;
end;
$$;

-- レス投稿（1000到達で自動的に過去スレ化）
drop function if exists add_reply(bigint, text, text, text);
drop function if exists add_reply(bigint, text, text, text, text);
create or replace function add_reply(
  p_thread_id bigint,
  p_content text,
  p_author_id text,
  p_author_token_hash text,
  p_image_paths text[] default null
) returns table(number integer, archived boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread threads%rowtype;
  v_next_number integer;
  v_will_archive boolean;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if is_banned(p_author_token_hash) then
    raise exception 'banned';
  end if;
  if length(trim(p_content)) = 0 and (p_image_paths is null or array_length(p_image_paths, 1) is null) then
    raise exception 'invalid_input';
  end if;

  select * into v_thread from threads where id = p_thread_id and is_deleted = false for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_thread.is_archived then
    raise exception 'archived';
  end if;

  v_next_number := v_thread.reply_count + 1;
  v_will_archive := v_next_number >= 1000;

  insert into replies (thread_id, number, author_id, author_token_hash, content, created_at, like_count, is_deleted, image_paths)
  values (p_thread_id, v_next_number, p_author_id, p_author_token_hash, left(trim(p_content), 2000), v_now, 0, false, p_image_paths);

  update threads set reply_count = v_next_number, last_reply_at = v_now, is_archived = v_will_archive
  where id = p_thread_id;

  return query select v_next_number, v_will_archive;
end;
$$;

-- いいねのトグル
create or replace function toggle_like(
  p_reply_id bigint,
  p_user_token_hash text
) returns table(liked boolean, like_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count integer;
begin
  select exists(select 1 from likes where reply_id = p_reply_id and user_token_hash = p_user_token_hash) into v_exists;

  if v_exists then
    delete from likes where reply_id = p_reply_id and user_token_hash = p_user_token_hash;
    update replies r set like_count = greatest(0, r.like_count - 1) where r.id = p_reply_id returning r.like_count into v_count;
    return query select false, v_count;
  else
    insert into likes (reply_id, user_token_hash, created_at) values (p_reply_id, p_user_token_hash, (extract(epoch from now()) * 1000)::bigint);
    update replies r set like_count = r.like_count + 1 where r.id = p_reply_id returning r.like_count into v_count;
    return query select true, v_count;
  end if;
end;
$$;

-- 通報の作成
create or replace function create_report(
  p_reply_id bigint,
  p_reason text,
  p_reporter_token_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id bigint;
begin
  select thread_id into v_thread_id from replies where id = p_reply_id;
  if not found then
    raise exception 'not_found';
  end if;
  insert into reports (thread_id, reply_id, reason, reporter_token_hash, created_at, status)
  values (v_thread_id, p_reply_id, left(coalesce(p_reason, ''), 300), p_reporter_token_hash, (extract(epoch from now()) * 1000)::bigint, 'pending');
end;
$$;

-- スレッド削除（本人 or 管理者）
create or replace function delete_thread(
  p_thread_id bigint,
  p_requester_token_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread threads%rowtype;
  v_is_admin boolean := auth.role() = 'authenticated';
begin
  select * into v_thread from threads where id = p_thread_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not v_is_admin and v_thread.creator_token_hash <> p_requester_token_hash then
    raise exception 'forbidden';
  end if;

  update threads set is_deleted = true where id = p_thread_id;
  update replies set is_deleted = true where thread_id = p_thread_id;
end;
$$;

-- レス削除（本人 or 管理者）
create or replace function delete_reply(
  p_reply_id bigint,
  p_requester_token_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply replies%rowtype;
  v_is_admin boolean := auth.role() = 'authenticated';
begin
  select * into v_reply from replies where id = p_reply_id;
  if not found then
    raise exception 'not_found';
  end if;
  if not v_is_admin and v_reply.author_token_hash <> p_requester_token_hash then
    raise exception 'forbidden';
  end if;

  update replies set is_deleted = true where id = p_reply_id;
end;
$$;

-- ========== 管理者専用の関数 ==========

create or replace function admin_delete_reply(p_reply_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update replies set is_deleted = true where id = p_reply_id;
end;
$$;

create or replace function admin_resolve_report(p_report_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update reports set status = 'resolved' where id = p_report_id;
end;
$$;

create or replace function admin_ban_by_reply(p_reply_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_token_hash text;
begin
  perform require_admin();
  select author_token_hash into v_token_hash from replies where id = p_reply_id;
  if not found then
    raise exception 'not_found';
  end if;
  insert into bans (token_hash, reason, created_at, active)
  values (v_token_hash, left(coalesce(p_reason, ''), 300), (extract(epoch from now()) * 1000)::bigint, true);
end;
$$;

create or replace function admin_ban_token(p_token_hash text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  insert into bans (token_hash, reason, created_at, active)
  values (p_token_hash, left(coalesce(p_reason, ''), 300), (extract(epoch from now()) * 1000)::bigint, true);
end;
$$;

create or replace function admin_unban(p_ban_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_admin();
  update bans set active = false where id = p_ban_id;
end;
$$;

-- ========== 権限付与 ==========
-- anon = ログインしていない一般の訪問者, authenticated = ログイン済み（＝管理者）

grant execute on function is_banned(text) to anon, authenticated;
grant execute on function create_thread(text, text, text, text, text[], text) to anon, authenticated;
grant execute on function add_reply(bigint, text, text, text, text[]) to anon, authenticated;
grant execute on function toggle_like(bigint, text) to anon, authenticated;
grant execute on function create_report(bigint, text, text) to anon, authenticated;
grant execute on function delete_thread(bigint, text) to anon, authenticated;
grant execute on function delete_reply(bigint, text) to anon, authenticated;
grant execute on function admin_delete_reply(bigint) to authenticated;
grant execute on function admin_resolve_report(bigint) to authenticated;
grant execute on function admin_ban_by_reply(bigint, text) to authenticated;
grant execute on function admin_ban_token(text, text) to authenticated;
grant execute on function admin_unban(bigint) to authenticated;

grant select on threads, replies, likes to anon, authenticated;
grant select on reports, bans to authenticated;

-- ========== 画像アップロード用のストレージ ==========
-- レスに画像を添付できるようにするためのバケット。
-- ・誰でも読める（公開）
-- ・誰でもアップロードできる（ログイン不要の掲示板のため）
-- ・誰でも削除できる（レス削除時に添付画像を自動で消すため。
-- 　この掲示板はアップロードも誰でもできる設計なので、それに合わせている）
-- ファイルサイズは5MBまで、画像ファイルのみアップロード可能。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images', 'post-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post-images public read" on storage.objects;
create policy "post-images public read"
  on storage.objects for select
  using (bucket_id = 'post-images');

drop policy if exists "post-images anyone can upload" on storage.objects;
create policy "post-images anyone can upload"
  on storage.objects for insert
  with check (bucket_id = 'post-images');

drop policy if exists "post-images admin can delete" on storage.objects;
drop policy if exists "post-images anyone can delete" on storage.objects;
create policy "post-images anyone can delete"
  on storage.objects for delete
  using (bucket_id = 'post-images');

-- ========== リアルタイム機能（新着レスの即時反映）==========
-- レス投稿やスレッドの状態変化を、ページをリロードしなくても
-- 他の人の画面にすぐ反映できるようにする。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'replies'
  ) then
    alter publication supabase_realtime add table replies;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'threads'
  ) then
    alter publication supabase_realtime add table threads;
  end if;
end $$;
