'use strict';

// Supabase接続設定
const SUPABASE_URL = 'https://hjnalcnbzckapbfwlzdr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbmFsY25iemNrYXBiZndsemRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzgyMzQsImV4cCI6MjA5NzI1NDIzNH0.7QBSRp-FDDcMEbPzprRiEaoa4s4FB7PCJSF4INOxz58';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 現在開いているスレッドID
let currentThreadId = null;
// リアルタイムチャンネル
let realtimeChannel = null;

// 日時フォーマット
function formatDate(iso) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return mm + '/' + dd + ' ' + hh + ':' + min + ':' + ss;
}

// 短いIDを生成（表示用）
function shortId(id) {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

// ━━━ スレッド一覧 ━━━

async function loadThreads() {
  const { data, error } = await db
    .from('threads')
    .select('*')
    .order('last_post_at', { ascending: false });

  if (error) { console.error(error); return; }

  const list = document.getElementById('threadList');
  const empty = document.getElementById('boardEmpty');
  list.innerHTML = '';

  if (!data || data.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  data.forEach(function(thread, i) {
    const item = document.createElement('div');
    item.className = 'thread-item';
    item.innerHTML =
      '<span class="thread-num">' + (i + 1) + '</span>' +
      '<div class="thread-info">' +
        '<div class="thread-name">' + escapeHtml(thread.title) + '</div>' +
        '<div class="thread-meta">' + formatDate(thread.created_at) + '</div>' +
      '</div>' +
      '<span class="thread-count">' + thread.post_count + '件</span>';
    item.addEventListener('click', function() { openThread(thread); });
    list.appendChild(item);
  });
}

// ━━━ スレッド開く ━━━

async function openThread(thread) {
  currentThreadId = thread.id;

  document.getElementById('boardView').classList.add('hidden');
  document.getElementById('threadView').classList.remove('hidden');
  document.getElementById('threadTitle').textContent = thread.title;
  document.getElementById('btnNew').classList.add('hidden');
  document.getElementById('postList').innerHTML = '';

  await loadPosts();
  subscribeRealtime();
}

function closeThread() {
  currentThreadId = null;
  if (realtimeChannel) {
    db.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  document.getElementById('threadView').classList.add('hidden');
  document.getElementById('boardView').classList.remove('hidden');
  document.getElementById('btnNew').classList.remove('hidden');
  loadThreads();
}

// ━━━ 投稿一覧読み込み ━━━

async function loadPosts() {
  const { data, error } = await db
    .from('posts')
    .select('*')
    .eq('thread_id', currentThreadId)
    .order('created_at', { ascending: true });

  if (error) { console.error(error); return; }

  const list = document.getElementById('postList');
  const empty = document.getElementById('threadEmpty');
  list.innerHTML = '';

  if (!data || data.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  data.forEach(function(post, i) {
    appendPost(post, i + 1);
  });

  scrollToBottom();
}

function appendPost(post, num) {
  const list = document.getElementById('postList');
  const empty = document.getElementById('threadEmpty');
  empty.classList.add('hidden');

  // 番号が渡されない場合は現在の投稿数+1
  if (!num) {
    num = list.children.length + 1;
  }

  const item = document.createElement('div');
  item.className = 'post-item';
  item.innerHTML =
    '<div class="post-header">' +
      '<span class="post-num">' + num + '</span>' +
      '<span class="post-name">' + escapeHtml(post.name || '名無し') + '</span>' +
      '<span class="post-time">' + formatDate(post.created_at) + '</span>' +
      '<span class="post-id">ID:' + shortId(post.id) + '</span>' +
    '</div>' +
    '<div class="post-body">' + escapeHtml(post.content) + '</div>';
  list.appendChild(item);
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

// ━━━ リアルタイム購読 ━━━

function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);

  realtimeChannel = db
    .channel('posts-' + currentThreadId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'posts', filter: 'thread_id=eq.' + currentThreadId },
      function(payload) {
        const list = document.getElementById('postList');
        appendPost(payload.new, list.children.length + 1);
        scrollToBottom();
      }
    )
    .subscribe();
}

// ━━━ スレ立て ━━━

async function submitThread() {
  const input = document.getElementById('threadTitleInput');
  const title = input.value.trim();
  if (!title) return;

  const btn = document.getElementById('submitThread');
  btn.disabled = true;

  const { error } = await db.from('threads').insert({ title });
  btn.disabled = false;

  if (error) { alert('スレ立て失敗しました'); console.error(error); return; }

  input.value = '';
  closeModal();
  loadThreads();
}

// ━━━ 投稿する ━━━

async function submitPost() {
  const nameEl = document.getElementById('postName');
  const contentEl = document.getElementById('postContent');
  const name = nameEl.value.trim() || '名無し';
  const content = contentEl.value.trim();
  if (!content) return;

  const btn = document.getElementById('submitPost');
  btn.disabled = true;

  const { error: postError } = await db.from('posts').insert({
    thread_id: currentThreadId,
    name,
    content,
  });

  if (postError) { alert('投稿失敗しました'); console.error(postError); btn.disabled = false; return; }

  // スレッドのpost_countとlast_post_atを更新
  const { count } = await db
    .from('posts')
    .select('*', { count: 'exact', head: true })
    .eq('thread_id', currentThreadId);
  await db
    .from('threads')
    .update({ post_count: count, last_post_at: new Date().toISOString() })
    .eq('id', currentThreadId);

  btn.disabled = false;
  contentEl.value = '';
  contentEl.focus();
}

// ━━━ モーダル ━━━

function openModal() {
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('threadTitleInput').focus();
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('threadTitleInput').value = '';
}

// ━━━ XSSエスケープ ━━━

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ━━━ イベント登録 ━━━

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('btnNew').addEventListener('click', openModal);
  document.getElementById('cancelThread').addEventListener('click', closeModal);
  document.getElementById('submitThread').addEventListener('click', submitThread);
  document.getElementById('btnBack').addEventListener('click', closeThread);
  document.getElementById('submitPost').addEventListener('click', submitPost);
  document.getElementById('siteLogo').addEventListener('click', function() {
    if (currentThreadId) closeThread();
  });

  // モーダル外クリックで閉じる
  document.getElementById('modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Enterキーでスレ立て
  document.getElementById('threadTitleInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitThread();
  });

  // Ctrl/Cmd+Enterで投稿
  document.getElementById('postContent').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitPost();
  });

  loadThreads();
});
