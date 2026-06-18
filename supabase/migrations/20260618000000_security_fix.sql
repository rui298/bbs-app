-- ═══════════════════════════════════════════════════
-- セキュリティ修正
-- ① owner_token を隠蔽するビューを作成
-- ② DELETE/UPDATE ポリシーをヘッダー検証に変更
-- ③ post_count 自動更新トリガー追加
-- ═══════════════════════════════════════════════════

-- ① x-owner-token ヘッダーを取得するヘルパー関数
CREATE OR REPLACE FUNCTION public.get_owner_token_header()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (current_setting('request.headers', true)::json)->>'x-owner-token',
    ''
  );
$$;

-- ② posts_view（owner_token → is_mine に変換）
CREATE OR REPLACE VIEW public.posts_view AS
  SELECT
    id, thread_id, name, icon, content, created_at, reply_to, edited_at, image_url,
    (owner_token = public.get_owner_token_header()) AS is_mine
  FROM public.posts;
GRANT SELECT ON public.posts_view TO anon, authenticated;

-- ③ threads_view
CREATE OR REPLACE VIEW public.threads_view AS
  SELECT
    id, title, category, created_at, last_post_at, post_count, is_pinned, author_name,
    (owner_token = public.get_owner_token_header()) AS is_mine
  FROM public.threads;
GRANT SELECT ON public.threads_view TO anon, authenticated;

-- ④ reactions_view
CREATE OR REPLACE VIEW public.reactions_view AS
  SELECT
    id, post_id, emoji, created_at,
    (owner_token = public.get_owner_token_header()) AS is_mine
  FROM public.reactions;
GRANT SELECT ON public.reactions_view TO anon, authenticated;

-- ⑤ owner_token カラムを anon から非公開に
REVOKE SELECT (owner_token) ON public.posts FROM anon, authenticated;
REVOKE SELECT (owner_token) ON public.threads FROM anon, authenticated;
REVOKE SELECT (owner_token) ON public.reactions FROM anon, authenticated;

-- ⑥ posts: DELETE（誰でも可）→ 自分のみに変更
DROP POLICY IF EXISTS "posts_delete" ON public.posts;
CREATE POLICY "posts_delete" ON public.posts FOR DELETE
  USING (owner_token = public.get_owner_token_header());

-- ⑦ posts: UPDATE ポリシーを新規追加（自分のみ）
DROP POLICY IF EXISTS "posts_update" ON public.posts;
CREATE POLICY "posts_update" ON public.posts FOR UPDATE
  USING (owner_token = public.get_owner_token_header())
  WITH CHECK (true);

-- ⑧ reactions: DELETE を自分のみに変更
DROP POLICY IF EXISTS "reactions_delete" ON public.reactions;
CREATE POLICY "reactions_delete" ON public.reactions FOR DELETE
  USING (owner_token = public.get_owner_token_header());

-- ⑨ threads: UPDATE をトリガーで代替し、スレッド主のみに変更
DROP POLICY IF EXISTS "threads_update" ON public.threads;
CREATE POLICY "threads_update" ON public.threads FOR UPDATE
  USING (owner_token = public.get_owner_token_header())
  WITH CHECK (true);

-- ⑩ threads: DELETE を自分のみに変更
DROP POLICY IF EXISTS "threads_delete" ON public.threads;
CREATE POLICY "threads_delete" ON public.threads FOR DELETE
  USING (owner_token = public.get_owner_token_header());

-- ⑪ post_count・last_post_at 自動更新トリガー
CREATE OR REPLACE FUNCTION public.update_thread_post_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE threads SET post_count = post_count + 1, last_post_at = NOW()
    WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE threads SET post_count = GREATEST(post_count - 1, 0)
    WHERE id = OLD.thread_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS posts_count_trigger ON public.posts;
CREATE TRIGGER posts_count_trigger
AFTER INSERT OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.update_thread_post_count();

-- ═══════════════════════════════════════════════════
-- owner_token カラムの完全非公開化
-- table-level SELECT を剥奪して必要カラムのみ再 GRANT
-- ═══════════════════════════════════════════════════
REVOKE SELECT ON TABLE public.posts FROM anon, authenticated;
REVOKE SELECT ON TABLE public.threads FROM anon, authenticated;
REVOKE SELECT ON TABLE public.reactions FROM anon, authenticated;

GRANT SELECT (id, thread_id, name, icon, content, created_at, reply_to, edited_at, image_url)
  ON public.posts TO anon, authenticated;
GRANT INSERT ON public.posts TO anon, authenticated;
GRANT DELETE ON public.posts TO anon, authenticated;
GRANT UPDATE (content, edited_at) ON public.posts TO anon, authenticated;

GRANT SELECT (id, title, category, created_at, last_post_at, post_count, is_pinned, author_name)
  ON public.threads TO anon, authenticated;
GRANT INSERT ON public.threads TO anon, authenticated;
GRANT DELETE ON public.threads TO anon, authenticated;
GRANT UPDATE (is_pinned) ON public.threads TO anon, authenticated;

GRANT SELECT (id, post_id, emoji, created_at)
  ON public.reactions TO anon, authenticated;
GRANT INSERT ON public.reactions TO anon, authenticated;
GRANT DELETE ON public.reactions TO anon, authenticated;
