// Supabase設定
const SUPABASE_URL = 'https://hjnalcnbzckapbfwlzdr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqbmFsY25iemNrYXBiZndsemRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzgyMzQsImV4cCI6MjA5NzI1NDIzNH0.7QBSRp-FDDcMEbPzprRiEaoa4s4FB7PCJSF4INOxz58';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// アイコン・リアクション定数
const EMOJIS = ['🐱','🐶','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐧','🐦','🦆','🦅','🦋','🐙','🦑','🐠','🐟','🦀','🐝','🌸','🌺','🍀','🌵','🌈','⭐','🔥','💎','🎮','🎵','🎨','🍕'];
const REACTION_EMOJIS = ['👍','😂','🎉','😮','🔥'];
const MAX_DRAFT = 20;

// 状態変数
let currentThread = null;
let currentThreadPostCount = 0;
let realtimeChannel = null;
let replyToPost = null;
let editPostId = null;
let imageFile = null;
let currentCategory = '全部';
let boardSearchText = '';

// ─── ユーティリティ ───
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function getMyToken() {
  let token = localStorage.getItem('bbs_owner_token');
  if (!token) { token = crypto.randomUUID(); localStorage.setItem('bbs_owner_token', token); }
  return token;
}

function formatTime(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// XSS対策エスケープ
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── プロフィール ───
function getProfile() {
  return { name: localStorage.getItem('bbs_name') || '名無し', icon: localStorage.getItem('bbs_icon') || '🐱' };
}

function loadProfile() {
  const p = getProfile();
  document.getElementById('btnProfile').textContent = p.icon;
  document.getElementById('postMyAvatar').textContent = p.icon;
}

function openProfileModal() {
  const p = getProfile();
  document.getElementById('profileNameInput').value = p.name;
  renderIconGrid(p.icon);
  document.getElementById('profileModal').classList.remove('hidden');
}

function renderIconGrid(selected) {
  const grid = document.getElementById('iconGrid');
  grid.innerHTML = EMOJIS.map(e =>
    `<button class="icon-btn${e === selected ? ' selected' : ''}" data-icon="${e}">${e}</button>`
  ).join('');
  grid.querySelectorAll('.icon-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

function saveProfileData() {
  const name = document.getElementById('profileNameInput').value.trim() || '名無し';
  const selected = document.querySelector('.icon-btn.selected');
  const icon = selected ? selected.dataset.icon : '🐱';
  localStorage.setItem('bbs_name', name);
  localStorage.setItem('bbs_icon', icon);
  loadProfile();
  document.getElementById('profileModal').classList.add('hidden');
}

// ─── 未読管理 ───
function getUnread(threadId, postCount) {
  const seen = parseInt(localStorage.getItem(`bbs_read_${threadId}`) || '0');
  return Math.max(0, (postCount || 0) - seen);
}

function markRead(threadId, count) {
  localStorage.setItem(`bbs_read_${threadId}`, String(count));
}

// ─── スレッド一覧 ───
async function loadThreads() {
  const { data, error } = await sb
    .from('threads')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('last_post_at', { ascending: false });
  if (error) { console.error(error); return; }
  renderThreadList(data || []);
}

function renderThreadList(threads) {
  let filtered = threads;
  if (currentCategory !== '全部') filtered = filtered.filter(t => t.category === currentCategory);
  if (boardSearchText) {
    const q = boardSearchText.toLowerCase();
    filtered = filtered.filter(t => t.title.toLowerCase().includes(q));
  }

  const list = document.getElementById('threadList');
  const empty = document.getElementById('boardEmpty');
  list.innerHTML = '';

  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const myToken = getMyToken();

  filtered.forEach(t => {
    const isOwner = t.owner_token === myToken;
    const unread = getUnread(t.id, t.post_count);
    const item = document.createElement('div');
    item.className = `thread-item${t.is_pinned ? ' pinned' : ''}`;
    item.dataset.id = t.id;

    item.innerHTML = `
      <div class="thread-icon">${escHtml(t.title.charAt(0))}</div>
      <div class="thread-body">
        <div class="thread-header-row">
          <span class="thread-author">${escHtml(t.author_name || '名無し')}</span>
          <span class="thread-cat-badge" data-cat="${escAttr(t.category || '雑談')}">${escHtml(t.category || '雑談')}</span>
          <span class="thread-time">${formatTime(t.created_at)}</span>
          ${t.is_pinned ? '<span class="pin-badge">📌</span>' : ''}
        </div>
        <div class="thread-name">${escHtml(t.title)}</div>
        <div class="thread-footer">
          <span class="thread-reply-count">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            ${t.post_count || 0}
            ${unread > 0 ? `<span class="unread-badge">+${unread}</span>` : ''}
          </span>
        </div>
      </div>
      <div class="thread-item-actions">
        ${isOwner ? `<button class="btn-pin${t.is_pinned ? ' active' : ''}" data-id="${t.id}" data-pinned="${t.is_pinned}" title="${t.is_pinned ? 'ピン解除' : 'ピン留め'}">📌</button>` : ''}
        ${isOwner ? `<button class="btn-delete-thread" data-id="${t.id}" title="スレ削除">🗑</button>` : ''}
      </div>
    `;

    // スレッドを開く（ボタン以外）
    item.addEventListener('click', e => {
      if (e.target.closest('.btn-pin') || e.target.closest('.btn-delete-thread')) return;
      openThread(t);
    });

    // ピン留めトグル
    const pinBtn = item.querySelector('.btn-pin');
    if (pinBtn) {
      pinBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const newPinned = pinBtn.dataset.pinned === 'true' ? false : true;
        await sb.from('threads').update({ is_pinned: newPinned }).eq('id', t.id).eq('owner_token', myToken);
        loadThreads();
      });
    }

    // スレ削除
    const delBtn = item.querySelector('.btn-delete-thread');
    if (delBtn) {
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('このスレッドを削除しますか？')) return;
        await sb.from('threads').delete().eq('id', t.id).eq('owner_token', myToken);
        loadThreads();
      });
    }

    list.appendChild(item);
  });
}

// ─── スレッドを開く ───
async function openThread(thread) {
  currentThread = thread;
  document.getElementById('boardView').classList.add('hidden');
  document.getElementById('threadView').classList.remove('hidden');
  document.getElementById('threadTitle').textContent = thread.title;
  document.getElementById('postList').innerHTML = '';
  document.getElementById('threadEmpty').classList.add('hidden');
  document.getElementById('postSearch').value = '';

  history.pushState(null, '', `#thread-${thread.id}`);

  // 自動下書き復元
  const autoDraft = localStorage.getItem(`bbs_auto_draft_${thread.id}`);
  if (autoDraft) {
    document.getElementById('postContent').value = autoDraft;
    updateCharCount();
  }

  await loadPosts(thread.id);

  // リアルタイム購読
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel(`posts:${thread.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'posts',
      filter: `thread_id=eq.${thread.id}`
    }, payload => {
      // 自分が送信済みの投稿はスキップ
      if (!document.querySelector(`.post-item[data-id="${payload.new.id}"]`)) {
        currentThreadPostCount++;
        appendPost(payload.new, currentThreadPostCount, null, []);
      }
    })
    .subscribe();
}

function closeThread() {
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (currentThread) markRead(currentThread.id, currentThreadPostCount);
  currentThread = null;
  cancelReply();
  clearImagePreview();
  document.getElementById('postContent').value = '';
  updateCharCount();
  document.getElementById('threadView').classList.add('hidden');
  document.getElementById('boardView').classList.remove('hidden');
  history.pushState(null, '', location.pathname);
  loadThreads();
}

// ─── 投稿一覧読み込み ───
async function loadPosts(threadId) {
  const { data: posts, error } = await sb
    .from('posts')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) { console.error(error); return; }

  currentThreadPostCount = (posts || []).length;

  // UUID→{post, num} マップ（引用参照用）
  const postMap = {};
  (posts || []).forEach((p, i) => { postMap[p.id] = { post: p, num: i + 1 }; });

  // リアクション一括取得
  const postIds = (posts || []).map(p => p.id);
  let reactionMap = {};
  if (postIds.length) {
    const { data: reactions } = await sb.from('reactions').select('*').in('post_id', postIds);
    (reactions || []).forEach(r => {
      if (!reactionMap[r.post_id]) reactionMap[r.post_id] = [];
      reactionMap[r.post_id].push(r);
    });
  }

  const list = document.getElementById('postList');
  list.innerHTML = '';

  if (!(posts || []).length) {
    document.getElementById('threadEmpty').classList.remove('hidden');
    markRead(threadId, 0);
    return;
  }

  (posts || []).forEach((p, i) => {
    appendPost(p, i + 1, postMap, reactionMap[p.id] || []);
  });

  markRead(threadId, currentThreadPostCount);
}

// ─── 投稿1件描画 ───
function appendPost(post, num, postMap, reactions) {
  const list = document.getElementById('postList');
  document.getElementById('threadEmpty').classList.add('hidden');

  if (!num) num = list.querySelectorAll('.post-item').length + 1;

  const myToken = getMyToken();
  const isOwner = post.owner_token === myToken;

  // 引用返信プレビュー（reply_to は UUID）
  let replyHtml = '';
  if (post.reply_to && postMap && postMap[post.reply_to]) {
    const { post: ref, num: refNum } = postMap[post.reply_to];
    const preview = ref.content.substring(0, 40) + (ref.content.length > 40 ? '…' : '');
    replyHtml = `<div class="post-reply-ref" data-ref-id="${post.reply_to}" data-ref-num="${refNum}">&gt;&gt;${refNum} ${escHtml(preview)}</div>`;
  }

  const imgHtml = post.image_url
    ? `<img class="post-image" src="${escHtml(post.image_url)}" alt="添付画像" loading="lazy">`
    : '';

  const editedHtml = post.edited_at ? ' <span class="post-edited">(編集済)</span>' : '';
  const reactionHtml = buildReactionHtml(reactions, post.id);

  const item = document.createElement('div');
  item.className = 'post-item';
  item.dataset.id = post.id;
  item.dataset.num = num;

  item.innerHTML = `
    <div class="post-avatar">${escHtml(post.icon || '🐱')}</div>
    <div class="post-right">
      <div class="post-header">
        <span class="post-name">${escHtml(post.name)}</span>
        <span class="post-dot">·</span>
        <span class="post-time">${formatTime(post.created_at)}</span>
        ${editedHtml}
        <span class="post-num" data-num="${num}">&gt;&gt;${num}</span>
      </div>
      ${replyHtml}
      <div class="post-body">${escHtml(post.content)}</div>
      ${imgHtml}
      <div class="reaction-bar" data-post-id="${post.id}">
        ${reactionHtml}
        <button class="add-reaction-btn" data-post-id="${post.id}">＋</button>
      </div>
      <div class="post-actions">
        <button class="btn-reply-post" data-num="${num}">返信</button>
        ${isOwner ? `<button class="btn-edit-post" data-id="${post.id}">編集</button>` : ''}
        ${isOwner ? `<button class="btn-delete-post" data-id="${post.id}">削除</button>` : ''}
      </div>
    </div>
  `;

  // >>N クリックで引用返信
  item.querySelector('.post-num').addEventListener('click', () => startReply(num, post.id));

  // 引用プレビュークリックで元投稿へスクロール
  const refEl = item.querySelector('.post-reply-ref');
  if (refEl) {
    refEl.addEventListener('click', () => {
      const refId = refEl.dataset.refId;
      const target = document.querySelector(`.post-item[data-id="${refId}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // リアクション
  item.querySelector('.add-reaction-btn').addEventListener('click', e => {
    toggleReactionPicker(e.currentTarget, post.id);
  });
  item.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      toggleReaction(post.id, btn.dataset.emoji, item.querySelector('.reaction-bar'));
    });
  });

  // 返信
  item.querySelector('.btn-reply-post').addEventListener('click', () => startReply(num, post.id));

  // 編集
  const editBtn = item.querySelector('.btn-edit-post');
  if (editBtn) editBtn.addEventListener('click', () => openEditModal(post.id, post.content));

  // 削除
  const delBtn = item.querySelector('.btn-delete-post');
  if (delBtn) delBtn.addEventListener('click', () => deletePost(post.id));

  // 画像クリックで別タブ
  const img = item.querySelector('.post-image');
  if (img) img.addEventListener('click', () => window.open(post.image_url, '_blank'));

  list.appendChild(item);
}

// ─── リアクション ───
function buildReactionHtml(reactions, postId) {
  const myToken = getMyToken();
  const counts = {};
  const mine = new Set();
  (reactions || []).forEach(r => {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.owner_token === myToken) mine.add(r.emoji);
  });
  return Object.entries(counts).map(([emoji, count]) =>
    `<button class="reaction-btn${mine.has(emoji) ? ' active' : ''}" data-emoji="${emoji}" data-post-id="${postId}">
      ${emoji} <span class="reaction-count">${count}</span>
    </button>`
  ).join('');
}

async function toggleReaction(postId, emoji, bar) {
  const myToken = getMyToken();
  const { data: existing } = await sb.from('reactions')
    .select('id')
    .eq('post_id', postId)
    .eq('emoji', emoji)
    .eq('owner_token', myToken)
    .maybeSingle();

  if (existing) {
    await sb.from('reactions').delete().eq('id', existing.id);
  } else {
    await sb.from('reactions').insert({ post_id: postId, emoji, owner_token: myToken });
  }

  // バー再描画
  const { data: reactions } = await sb.from('reactions').select('*').eq('post_id', postId);
  const addBtnHtml = `<button class="add-reaction-btn" data-post-id="${postId}">＋</button>`;
  bar.innerHTML = buildReactionHtml(reactions || [], postId) + addBtnHtml;

  bar.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleReaction(postId, btn.dataset.emoji, bar));
  });
  bar.querySelector('.add-reaction-btn').addEventListener('click', e => {
    toggleReactionPicker(e.currentTarget, postId);
  });
}

function toggleReactionPicker(btn, postId) {
  document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  REACTION_EMOJIS.forEach(emoji => {
    const b = document.createElement('button');
    b.textContent = emoji;
    b.addEventListener('click', () => {
      picker.remove();
      toggleReaction(postId, emoji, btn.closest('.reaction-bar'));
    });
    picker.appendChild(b);
  });

  btn.parentNode.insertBefore(picker, btn.nextSibling);

  setTimeout(() => {
    const close = e => {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); }
    };
    document.addEventListener('click', close);
  }, 0);
}

// ─── 引用返信 ───
// replyToPost = { num: 表示番号, id: UUID }
function startReply(num, postId) {
  replyToPost = { num, id: postId };
  document.getElementById('replyIndicatorText').textContent = `>> ${num} に返信`;
  document.getElementById('replyIndicator').classList.remove('hidden');
  document.getElementById('postContent').focus();
}

function cancelReply() {
  replyToPost = null;
  document.getElementById('replyIndicator').classList.add('hidden');
  document.getElementById('replyIndicatorText').textContent = '';
}

// ─── 投稿編集 ───
function openEditModal(postId, content) {
  editPostId = postId;
  document.getElementById('editContent').value = content;
  document.getElementById('editModal').classList.remove('hidden');
}

async function saveEdit() {
  const content = document.getElementById('editContent').value.trim();
  if (!content || !editPostId) return;
  const btn = document.getElementById('saveEdit');
  btn.disabled = true;

  await sb.from('posts')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', editPostId)
    .eq('owner_token', getMyToken());

  document.getElementById('editModal').classList.add('hidden');
  editPostId = null;
  btn.disabled = false;
  await loadPosts(currentThread.id);
}

// ─── 投稿削除 ───
async function deletePost(postId) {
  if (!confirm('この投稿を削除しますか？')) return;
  await sb.from('posts').delete().eq('id', postId).eq('owner_token', getMyToken());
  const item = document.querySelector(`.post-item[data-id="${postId}"]`);
  if (item) item.remove();
  currentThreadPostCount = Math.max(0, currentThreadPostCount - 1);
  await sb.from('threads').update({ post_count: currentThreadPostCount }).eq('id', currentThread.id);
}

// ─── 投稿送信 ───
async function submitPost() {
  const content = document.getElementById('postContent').value.trim();
  if (!content && !imageFile) return;

  const btn = document.getElementById('submitPost');
  btn.disabled = true;
  btn.textContent = '送信中…';

  const profile = getProfile();
  let imageUrl = null;

  if (imageFile) {
    const ext = imageFile.name.split('.').pop().toLowerCase();
    const path = `${currentThread.id}/${Date.now()}.${ext}`;
    const { error: uploadError } = await sb.storage.from('images').upload(path, imageFile, { contentType: imageFile.type });
    if (!uploadError) {
      const { data: urlData } = sb.storage.from('images').getPublicUrl(path);
      imageUrl = urlData.publicUrl;
    }
  }

  const payload = {
    thread_id: currentThread.id,
    name: profile.name,
    icon: profile.icon,
    content: content || '',
    owner_token: getMyToken(),
    reply_to: replyToPost ? replyToPost.id : null,
    image_url: imageUrl,
  };

  const { data: newPost, error } = await sb.from('posts').insert(payload).select().single();
  if (!error && newPost) {
    currentThreadPostCount++;
    document.getElementById('postContent').value = '';
    updateCharCount();
    cancelReply();
    clearImagePreview();
    localStorage.removeItem(`bbs_auto_draft_${currentThread.id}`);
    document.getElementById('autoSaveLabel').textContent = '';
    await sb.from('threads').update({
      post_count: currentThreadPostCount,
      last_post_at: new Date().toISOString()
    }).eq('id', currentThread.id);
    // 自分の投稿を即時表示（リアルタイムの重複防止）
    if (!document.querySelector(`.post-item[data-id="${newPost.id}"]`)) {
      // 既存投稿からpostMapを構築して引用プレビューを表示
      const domMap = {};
      document.querySelectorAll('.post-item').forEach(el => {
        const id = el.dataset.id;
        const n = parseInt(el.dataset.num);
        const content = el.querySelector('.post-body')?.textContent || '';
        if (id && n) domMap[id] = { post: { id, content }, num: n };
      });
      appendPost(newPost, currentThreadPostCount, domMap, []);
    }
    markRead(currentThread.id, currentThreadPostCount);
  }

  btn.disabled = false;
  btn.textContent = '投稿';
}

// ─── スレッド作成 ───
async function submitThread() {
  const title = document.getElementById('threadTitleInput').value.trim();
  if (!title) return;

  const activeBtn = document.querySelector('.cat-select-btn.active');
  const category = activeBtn ? activeBtn.dataset.cat : '雑談';
  const profile = getProfile();

  const { error } = await sb.from('threads').insert({
    title,
    category,
    owner_token: getMyToken(),
    author_name: profile.name,
    is_pinned: false,
  });

  if (!error) {
    document.getElementById('threadTitleInput').value = '';
    document.getElementById('modal').classList.add('hidden');
    loadThreads();
  }
}

// ─── 画像プレビュー ───
function handleImageSelect(file) {
  imageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('imagePreviewImg').src = e.target.result;
    document.getElementById('imagePreviewArea').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearImagePreview() {
  imageFile = null;
  document.getElementById('imagePreviewImg').src = '';
  document.getElementById('imagePreviewArea').classList.add('hidden');
  document.getElementById('imageInput').value = '';
}

// ─── 文字数カウンター ───
function updateCharCount() {
  const len = document.getElementById('postContent').value.length;
  document.getElementById('charCount').textContent = len;
  const counter = document.getElementById('charCount').closest('.char-counter');
  counter.classList.remove('warn', 'danger');
  if (len > 900) counter.classList.add('danger');
  else if (len > 700) counter.classList.add('warn');
}

// ─── 下書き ───
function saveDraft() {
  const content = document.getElementById('postContent').value.trim();
  if (!content) return;
  const drafts = JSON.parse(localStorage.getItem('bbs_drafts') || '[]');
  drafts.unshift({ content, time: new Date().toISOString() });
  if (drafts.length > MAX_DRAFT) drafts.splice(MAX_DRAFT);
  localStorage.setItem('bbs_drafts', JSON.stringify(drafts));
  updateDraftCount();
  const label = document.getElementById('autoSaveLabel');
  label.textContent = '保存しました';
  setTimeout(() => { label.textContent = ''; }, 2000);
}

const autoSave = debounce(() => {
  if (!currentThread) return;
  const content = document.getElementById('postContent').value;
  if (content) {
    localStorage.setItem(`bbs_auto_draft_${currentThread.id}`, content);
    document.getElementById('autoSaveLabel').textContent = '自動保存済';
  } else {
    localStorage.removeItem(`bbs_auto_draft_${currentThread.id}`);
    document.getElementById('autoSaveLabel').textContent = '';
  }
}, 500);

function updateDraftCount() {
  const drafts = JSON.parse(localStorage.getItem('bbs_drafts') || '[]');
  document.getElementById('draftCount').textContent = drafts.length;
}

function renderDraftList() {
  const drafts = JSON.parse(localStorage.getItem('bbs_drafts') || '[]');
  const list = document.getElementById('draftList');
  if (!drafts.length) { list.innerHTML = '<p class="draft-empty">下書きはありません</p>'; return; }

  list.innerHTML = drafts.map((d, i) => `
    <div class="draft-item">
      <div class="draft-content" data-index="${i}">
        <div class="draft-text">${escHtml(d.content)}</div>
        <div class="draft-time">${formatTime(d.time)}</div>
      </div>
      <button class="btn-draft-delete" data-index="${i}">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.draft-content').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('postContent').value = drafts[parseInt(el.dataset.index)].content;
      updateCharCount();
      document.getElementById('draftModal').classList.add('hidden');
    });
  });

  list.querySelectorAll('.btn-draft-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      drafts.splice(parseInt(btn.dataset.index), 1);
      localStorage.setItem('bbs_drafts', JSON.stringify(drafts));
      updateDraftCount();
      renderDraftList();
    });
  });
}

// ─── 共有URLコピー ───
function shareThread() {
  const url = `${location.origin}${location.pathname}#thread-${currentThread.id}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('btnShare');
    const original = btn.textContent;
    btn.textContent = '✓ コピーしました';
    setTimeout(() => { btn.textContent = original; }, 2000);
  });
}

// ─── ハッシュルーティング ───
async function handleHash() {
  const hash = location.hash;
  if (!hash.startsWith('#thread-')) return;
  const threadId = hash.replace('#thread-', '');
  const { data } = await sb.from('threads').select('*').eq('id', threadId).maybeSingle();
  if (data) openThread(data);
}

// ─── 投稿検索 ───
function filterPosts(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.post-item').forEach(item => {
    const text = item.querySelector('.post-body')?.textContent.toLowerCase() || '';
    item.classList.toggle('hidden-by-search', q !== '' && !text.includes(q));
  });
}

// ─── 初期化 ───
document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  updateDraftCount();

  if (location.hash.startsWith('#thread-')) {
    handleHash();
  } else {
    loadThreads();
  }

  // プロフィール
  document.getElementById('btnProfile').addEventListener('click', openProfileModal);
  document.getElementById('saveProfile').addEventListener('click', saveProfileData);
  document.getElementById('cancelProfile').addEventListener('click', () => {
    document.getElementById('profileModal').classList.add('hidden');
  });

  // スレ立て
  document.getElementById('btnNew').addEventListener('click', () => {
    document.getElementById('modal').classList.remove('hidden');
  });
  document.getElementById('cancelThread').addEventListener('click', () => {
    document.getElementById('modal').classList.add('hidden');
  });
  document.getElementById('submitThread').addEventListener('click', submitThread);

  // カテゴリ選択（スレ立てモーダル）
  document.querySelectorAll('.cat-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ボード検索
  document.getElementById('boardSearch').addEventListener('input', debounce(e => {
    boardSearchText = e.target.value;
    loadThreads();
  }, 300));

  // カテゴリタブ
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.cat;
      loadThreads();
    });
  });

  // 戻る
  document.getElementById('btnBack').addEventListener('click', closeThread);
  document.getElementById('siteLogo').addEventListener('click', () => {
    if (!document.getElementById('threadView').classList.contains('hidden')) closeThread();
  });

  // 共有
  document.getElementById('btnShare').addEventListener('click', shareThread);

  // 投稿検索
  document.getElementById('postSearch').addEventListener('input', debounce(e => {
    filterPosts(e.target.value);
  }, 200));

  // 投稿送信
  document.getElementById('submitPost').addEventListener('click', submitPost);

  // Ctrl+Enter で送信
  document.getElementById('postContent').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submitPost();
  });

  // 文字数 & 自動保存
  document.getElementById('postContent').addEventListener('input', () => {
    updateCharCount();
    autoSave();
  });

  // 引用キャンセル
  document.getElementById('cancelReply').addEventListener('click', cancelReply);

  // 画像
  document.getElementById('imageInput').addEventListener('change', e => {
    if (e.target.files[0]) handleImageSelect(e.target.files[0]);
  });
  document.getElementById('cancelImage').addEventListener('click', clearImagePreview);

  // 下書き
  document.getElementById('btnDraftSave').addEventListener('click', saveDraft);
  document.getElementById('btnDraftList').addEventListener('click', () => {
    renderDraftList();
    document.getElementById('draftModal').classList.remove('hidden');
  });
  document.getElementById('closeDraftModal').addEventListener('click', () => {
    document.getElementById('draftModal').classList.add('hidden');
  });

  // 編集保存
  document.getElementById('saveEdit').addEventListener('click', saveEdit);
  document.getElementById('cancelEdit').addEventListener('click', () => {
    document.getElementById('editModal').classList.add('hidden');
    editPostId = null;
  });

  // スクロールトップ
  const scrollTopBtn = document.getElementById('scrollTop');
  window.addEventListener('scroll', () => {
    scrollTopBtn.classList.toggle('hidden', window.scrollY < 300);
  });
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // モーダル外クリックで閉じる
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // ブラウザ戻るボタン対応
  window.addEventListener('popstate', () => {
    if (!location.hash && !document.getElementById('threadView').classList.contains('hidden')) {
      if (realtimeChannel) sb.removeChannel(realtimeChannel);
      if (currentThread) markRead(currentThread.id, currentThreadPostCount);
      currentThread = null;
      document.getElementById('threadView').classList.add('hidden');
      document.getElementById('boardView').classList.remove('hidden');
      loadThreads();
    }
  });
});
