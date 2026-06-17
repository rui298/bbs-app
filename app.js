'use strict';

// Supabase接続設定
const SUPABASE_URL = 'https://hjnalcnbzckapbfwlzdr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbmFsY25iemNrYXBiZndsemRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzgyMzQsImV4cCI6MjA5NzI1NDIzNH0.7QBSRp-FDDcMEbPzprRiEaoa4s4FB7PCJSF4INOxz58';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 動物絵文字アイコン一覧
const ICONS = [
  '🐱','🐶','🦊','🐻','🐼','🐨','🐯','🦁',
  '🐮','🐷','🐸','🐙','🦋','🐧','🦆','🦅',
  '🦉','🐺','🦝','🦔','🐹','🐰','🦜','🐬',
  '🐳','🦈','🦑','🐿️','🦒','🦓','🐘','🦏',
];

// ━━━ 下書き管理 ━━━

const DRAFT_AUTO_KEY = 'bbs_auto_draft';
const DRAFT_LIST_KEY = 'bbs_drafts';
const MAX_DRAFTS = 20;
let autoSaveTimer = null;

function getDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_LIST_KEY) || '[]'); } catch(e) { return []; }
}

function saveDrafts(drafts) {
  localStorage.setItem(DRAFT_LIST_KEY, JSON.stringify(drafts));
}

// 自動保存（入力のたびに500msデバウンス）
function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function() {
    const content = document.getElementById('postContent').value;
    if (content.trim()) {
      localStorage.setItem(DRAFT_AUTO_KEY, content);
      const label = document.getElementById('autoSaveLabel');
      label.textContent = '自動保存済み';
      setTimeout(function() { label.textContent = ''; }, 2000);
    } else {
      localStorage.removeItem(DRAFT_AUTO_KEY);
    }
  }, 500);
}

// 手動で下書き保存
function saveDraft() {
  const content = document.getElementById('postContent').value.trim();
  if (!content) return;
  const drafts = getDrafts();
  drafts.unshift({ id: Date.now(), content, savedAt: new Date().toISOString() });
  if (drafts.length > MAX_DRAFTS) drafts.pop();
  saveDrafts(drafts);
  updateDraftCount();
  const label = document.getElementById('autoSaveLabel');
  label.textContent = '保存しました';
  setTimeout(function() { label.textContent = ''; }, 2000);
}

// 下書きの件数表示を更新
function updateDraftCount() {
  document.getElementById('draftCount').textContent = getDrafts().length;
}

// 下書き一覧モーダルを開く
function openDraftModal() {
  renderDraftList();
  document.getElementById('draftModal').classList.remove('hidden');
}

function closeDraftModal() {
  document.getElementById('draftModal').classList.add('hidden');
}

// 下書き一覧を描画
function renderDraftList() {
  const drafts = getDrafts();
  const container = document.getElementById('draftList');
  container.innerHTML = '';

  if (drafts.length === 0) {
    container.innerHTML = '<div class="draft-empty">下書きはありません</div>';
    return;
  }

  drafts.forEach(function(draft) {
    const item = document.createElement('div');
    item.className = 'draft-item';
    item.innerHTML =
      '<div class="draft-content">' +
        '<div class="draft-text">' + escapeHtml(draft.content) + '</div>' +
        '<div class="draft-time">' + formatDate(draft.savedAt) + '</div>' +
      '</div>' +
      '<button class="btn-draft-delete" data-id="' + draft.id + '" title="削除">✕</button>';

    // 本文クリックで読み込み
    item.querySelector('.draft-content').addEventListener('click', function() {
      document.getElementById('postContent').value = draft.content;
      document.getElementById('postContent').focus();
      closeDraftModal();
    });

    // 削除ボタン
    item.querySelector('.btn-draft-delete').addEventListener('click', function(e) {
      e.stopPropagation();
      const newDrafts = getDrafts().filter(function(d) { return d.id !== draft.id; });
      saveDrafts(newDrafts);
      updateDraftCount();
      renderDraftList();
    });

    container.appendChild(item);
  });
}

// スレッドを開いたとき自動保存の内容を復元
function restoreAutoDraft() {
  const saved = localStorage.getItem(DRAFT_AUTO_KEY);
  if (saved) document.getElementById('postContent').value = saved;
}

// プロフィールをlocalStorageから読む
function loadProfile() {
  return {
    name: localStorage.getItem('bbs_name') || '',
    icon: localStorage.getItem('bbs_icon') || '🐱',
  };
}

// プロフィールをlocalStorageに保存
function saveProfileData(name, icon) {
  localStorage.setItem('bbs_name', name);
  localStorage.setItem('bbs_icon', icon);
}

// ヘッダーとフォームのアイコンを更新
function syncProfileUI() {
  const { icon } = loadProfile();
  document.getElementById('btnProfile').textContent = icon;
  document.getElementById('postMyAvatar').textContent = icon;
}

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
  data.forEach(function(thread) {
    const initial = thread.title.charAt(0);
    const item = document.createElement('div');
    item.className = 'thread-item';
    item.innerHTML =
      '<div class="thread-icon">' + escapeHtml(initial) + '</div>' +
      '<div class="thread-body">' +
        '<div class="thread-top-row">' +
          '<span class="thread-author">名無し</span>' +
          '<span class="thread-time">· ' + formatDate(thread.created_at) + '</span>' +
        '</div>' +
        '<div class="thread-name">' + escapeHtml(thread.title) + '</div>' +
        '<div class="thread-actions">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"/></svg>' +
          thread.post_count + '件の返信' +
        '</div>' +
      '</div>';
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
  restoreAutoDraft();
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

  const name = post.name || '名無し';
  const icon = post.icon || '🐱';
  const item = document.createElement('div');
  item.className = 'post-item';
  item.innerHTML =
    '<div class="post-avatar">' + icon + '</div>' +
    '<div class="post-right">' +
      '<div class="post-header">' +
        '<span class="post-name">' + escapeHtml(name) + '</span>' +
        '<span class="post-dot">·</span>' +
        '<span class="post-time">' + formatDate(post.created_at) + '</span>' +
        '<span class="post-num">' + num + '</span>' +
      '</div>' +
      '<div class="post-body">' + escapeHtml(post.content) + '</div>' +
    '</div>';
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
  const contentEl = document.getElementById('postContent');
  const profile = loadProfile();
  const name = profile.name || '名無し';
  const icon = profile.icon;
  const content = contentEl.value.trim();
  if (!content) return;

  const btn = document.getElementById('submitPost');
  btn.disabled = true;

  const { error: postError } = await db.from('posts').insert({
    thread_id: currentThreadId,
    name,
    icon,
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
  localStorage.removeItem(DRAFT_AUTO_KEY);
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

// ━━━ プロフィールモーダル ━━━

let selectedIcon = '🐱';

function openProfileModal() {
  const profile = loadProfile();
  selectedIcon = profile.icon;
  document.getElementById('profileNameInput').value = profile.name;

  // アイコングリッドを描画
  const grid = document.getElementById('iconGrid');
  grid.innerHTML = '';
  ICONS.forEach(function(emoji) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn' + (emoji === selectedIcon ? ' selected' : '');
    btn.textContent = emoji;
    btn.addEventListener('click', function() {
      selectedIcon = emoji;
      grid.querySelectorAll('.icon-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
    });
    grid.appendChild(btn);
  });

  document.getElementById('profileModal').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.add('hidden');
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

  // プロフィール
  document.getElementById('btnProfile').addEventListener('click', openProfileModal);
  document.getElementById('cancelProfile').addEventListener('click', closeProfileModal);
  document.getElementById('saveProfile').addEventListener('click', function() {
    const name = document.getElementById('profileNameInput').value.trim();
    saveProfileData(name, selectedIcon);
    syncProfileUI();
    closeProfileModal();
  });
  document.getElementById('profileModal').addEventListener('click', function(e) {
    if (e.target === this) closeProfileModal();
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

  // 下書き
  document.getElementById('postContent').addEventListener('input', triggerAutoSave);
  document.getElementById('btnDraftSave').addEventListener('click', saveDraft);
  document.getElementById('btnDraftList').addEventListener('click', openDraftModal);
  document.getElementById('closeDraftModal').addEventListener('click', closeDraftModal);
  document.getElementById('draftModal').addEventListener('click', function(e) {
    if (e.target === this) closeDraftModal();
  });
  updateDraftCount();

  syncProfileUI();
  loadThreads();
});
