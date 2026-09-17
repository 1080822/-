(() => {
  const app = document.getElementById('app');
  const myIdEl = document.getElementById('my-id');
  const toastEl = document.getElementById('toast');

  const state = {
    isAdmin: false,
    tab: 'active', // active | archived | bookmarks
    reportTargetReplyId: null,
    identity: null,
  };

  // ---------- ユーティリティ ----------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nl2br(escaped) {
    return escaped.replace(/\n/g, '<br>');
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  function errorMessage(err) {
    const map = {
      banned: 'あなたはBANされているため投稿できません。',
      archived: 'このスレッドは過去スレのため書き込めません。',
      invalid_input: 'タイトルまたは本文を入力してください。',
      not_found: '見つかりませんでした（削除された可能性があります）。',
      forbidden: 'この操作を行う権限がありません。',
    };
    const msg = err && err.message;
    return map[msg] || 'エラーが発生しました。';
  }

  // ---------- 連投防止（クライアント側の目安。厳密な制限ではありません） ----------
  let lastPostAt = 0;
  function checkCooldown() {
    const now = Date.now();
    if (now - lastPostAt < 4000) return false;
    lastPostAt = now;
    return true;
  }

  // ---------- ブックマーク（ローカル保存） ----------
  const BOOKMARK_KEY = 'board_bookmarks_v1';
  function getBookmarks() {
    try {
      return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function isBookmarked(id) {
    return getBookmarks().includes(id);
  }
  function toggleBookmark(id) {
    let list = getBookmarks();
    if (list.includes(id)) {
      list = list.filter((x) => x !== id);
    } else {
      list.push(id);
    }
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(list));
  }

  // ---------- ルーティング ----------
  function currentRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const m = hash.match(/^\/thread\/(\d+)$/);
    if (m) return { name: 'thread', id: Number(m[1]) };
    return { name: 'list' };
  }

  async function loadMe() {
    state.identity = await window.BoardIdentity.getIdentity();
    const { data } = await window.sb.auth.getSession();
    state.isAdmin = !!(data && data.session);
    myIdEl.textContent = 'あなたのID: ' + state.identity.displayId + (state.isAdmin ? '（管理者）' : '');
  }

  async function route() {
    const r = currentRoute();
    if (r.name === 'thread') {
      await renderThread(r.id);
    } else {
      await renderList();
    }
  }

  // ---------- 一覧画面 ----------
  async function renderList() {
    const tpl = document.getElementById('tpl-list');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));

    app.querySelectorAll('.tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderList();
      });
    });

    const newThreadBtn = document.getElementById('new-thread-btn');
    const form = document.getElementById('new-thread-form');
    newThreadBtn.addEventListener('click', () => form.classList.toggle('hidden'));
    document.getElementById('new-thread-cancel').addEventListener('click', () => {
      form.classList.add('hidden');
    });
    document.getElementById('new-thread-submit').addEventListener('click', async () => {
      const title = document.getElementById('new-thread-title').value.trim();
      const content = document.getElementById('new-thread-content').value.trim();
      if (!title || !content) {
        showToast('タイトルと本文を入力してください。');
        return;
      }
      if (!checkCooldown()) {
        showToast('連続投稿はできません。少し待ってから試してください。');
        return;
      }
      const { data, error } = await window.sb.rpc('create_thread', {
        p_title: title,
        p_content: content,
        p_author_id: state.identity.displayId,
        p_author_token_hash: state.identity.tokenHash,
      });
      if (error) {
        showToast(errorMessage(error));
        return;
      }
      location.hash = '#/thread/' + data;
    });

    const listEl = document.getElementById('thread-list');
    const emptyEl = document.getElementById('empty-msg');
    listEl.innerHTML = '<li class="empty-msg">読み込み中...</li>';

    let threads = [];
    try {
      if (state.tab === 'bookmarks') {
        const [{ data: activeRows }, { data: archivedRows }] = await Promise.all([
          window.sb.from('threads').select('*').eq('is_deleted', false).eq('is_archived', false),
          window.sb.from('threads').select('*').eq('is_deleted', false).eq('is_archived', true),
        ]);
        const bookmarks = new Set(getBookmarks());
        threads = [...(activeRows || []), ...(archivedRows || [])]
          .filter((t) => bookmarks.has(t.id))
          .sort((a, b) => b.last_reply_at - a.last_reply_at);
      } else {
        const { data, error } = await window.sb
          .from('threads')
          .select('*')
          .eq('is_deleted', false)
          .eq('is_archived', state.tab === 'archived')
          .order('last_reply_at', { ascending: false });
        if (error) throw error;
        threads = data || [];
      }
    } catch (err) {
      listEl.innerHTML = '';
      showToast('スレッド一覧の取得に失敗しました。');
      return;
    }

    listEl.innerHTML = '';
    if (threads.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    for (const t of threads) {
      const li = document.createElement('li');
      li.className = 'thread-item';
      const bookmarked = isBookmarked(t.id);
      li.innerHTML = `
        <div class="thread-item-main">
          <a class="thread-item-title" href="#/thread/${t.id}">${escapeHtml(t.title)}</a>
          <div class="thread-item-meta">最終レス: ${formatDate(t.last_reply_at)}${
        t.is_archived ? '<span class="archived-badge">過去スレ</span>' : ''
      }</div>
        </div>
        <span class="thread-item-count">${t.reply_count}</span>
        <button class="bookmark-btn ${bookmarked ? 'active' : ''}" data-id="${t.id}" title="お気に入り">${
        bookmarked ? '★' : '☆'
      }</button>
      `;
      li.querySelector('.bookmark-btn').addEventListener('click', (e) => {
        toggleBookmark(t.id);
        const btn = e.currentTarget;
        const nowOn = isBookmarked(t.id);
        btn.classList.toggle('active', nowOn);
        btn.textContent = nowOn ? '★' : '☆';
        if (state.tab === 'bookmarks' && !nowOn) renderList();
      });
      listEl.appendChild(li);
    }
  }

  // ---------- スレッド詳細画面 ----------
  async function renderThread(id) {
    const tpl = document.getElementById('tpl-thread');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));

    const { data: thread, error: threadErr } = await window.sb
      .from('threads')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (threadErr || !thread) {
      app.innerHTML = '<p class="empty-msg">スレッドが見つかりませんでした。<br><a href="#/">一覧へ戻る</a></p>';
      return;
    }

    const { data: replies } = await window.sb
      .from('replies')
      .select('*')
      .eq('thread_id', id)
      .order('number', { ascending: true });

    const replyIds = (replies || []).map((r) => r.id);
    let likedIds = [];
    if (replyIds.length > 0) {
      const { data: likeRows } = await window.sb
        .from('likes')
        .select('reply_id')
        .eq('user_token_hash', state.identity.tokenHash)
        .in('reply_id', replyIds);
      likedIds = (likeRows || []).map((r) => r.reply_id);
    }

    document.getElementById('thread-title').textContent = thread.title;
    const isOwner = thread.creator_token_hash === state.identity.tokenHash;
    const canDeleteThread = isOwner || state.isAdmin;
    document.getElementById('thread-meta').innerHTML = `
      レス数 ${thread.reply_count}　${
      thread.is_archived ? '<span class="archived-badge">過去スレ</span>' : ''
    }
      ${canDeleteThread ? ' 　<button class="delete-link" id="delete-thread-btn">このスレッドを削除</button>' : ''}
    `;

    if (canDeleteThread) {
      document.getElementById('delete-thread-btn').addEventListener('click', async () => {
        if (!confirm('このスレッドを削除します。よろしいですか？')) return;
        const { error } = await window.sb.rpc('delete_thread', {
          p_thread_id: id,
          p_requester_token_hash: state.identity.tokenHash,
        });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        showToast('削除しました。');
        location.hash = '#/';
      });
    }

    const replyList = document.getElementById('reply-list');
    replyList.innerHTML = '';
    for (const r of replies || []) {
      const li = document.createElement('li');
      li.className = 'reply-item' + (r.is_deleted ? ' deleted' : '');
      const content = r.is_deleted ? '（このレスは削除されました）' : r.content;
      const bodyHtml = r.is_deleted ? escapeHtml(content) : nl2br(escapeHtml(content));
      const likedByMe = likedIds.includes(r.id);
      li.innerHTML = `
        <div class="reply-item-head">
          <span class="reply-number">${r.number}</span>
          <span class="reply-id">ID:${escapeHtml(r.author_id)}</span>
          <span>${formatDate(r.created_at)}</span>
        </div>
        <div class="reply-body">${bodyHtml}</div>
        ${
          r.is_deleted
            ? ''
            : `<div class="reply-actions">
                <button class="like-btn ${likedByMe ? 'liked' : ''}" data-id="${r.id}">
                  <span class="heart">♡</span><span class="like-count">${r.like_count}</span>
                </button>
                <button class="report-link" data-id="${r.id}">通報</button>
                ${
                  state.isAdmin
                    ? `<button class="delete-link" data-id="${r.id}">レス削除</button>`
                    : ''
                }
              </div>`
        }
      `;
      replyList.appendChild(li);

      if (!r.is_deleted) {
        li.querySelector('.like-btn').addEventListener('click', async (e) => {
          const { data, error } = await window.sb.rpc('toggle_like', {
            p_reply_id: r.id,
            p_user_token_hash: state.identity.tokenHash,
          });
          if (error) {
            showToast(errorMessage(error));
            return;
          }
          const row = data[0];
          const btn = e.currentTarget;
          btn.classList.toggle('liked', row.liked);
          btn.querySelector('.like-count').textContent = row.like_count;
        });
        li.querySelector('.report-link').addEventListener('click', () => {
          openReportModal(r.id);
        });
        const delBtn = li.querySelector('.delete-link');
        if (delBtn) {
          delBtn.addEventListener('click', async () => {
            if (!confirm('このレスを削除します。よろしいですか？')) return;
            const { error } = await window.sb.rpc('admin_delete_reply', { p_reply_id: r.id });
            if (error) {
              showToast(errorMessage(error));
              return;
            }
            renderThread(id);
          });
        }
      }
    }

    const replyForm = document.getElementById('reply-form');
    const archivedMsg = document.getElementById('archived-msg');
    if (thread.is_archived) {
      replyForm.classList.add('hidden');
      archivedMsg.classList.remove('hidden');
    } else {
      replyForm.classList.remove('hidden');
      archivedMsg.classList.add('hidden');
      document.getElementById('reply-submit').addEventListener('click', async () => {
        const content = document.getElementById('reply-content').value.trim();
        if (!content) {
          showToast('本文を入力してください。');
          return;
        }
        if (!checkCooldown()) {
          showToast('連続投稿はできません。少し待ってから試してください。');
          return;
        }
        const { error } = await window.sb.rpc('add_reply', {
          p_thread_id: id,
          p_content: content,
          p_author_id: state.identity.displayId,
          p_author_token_hash: state.identity.tokenHash,
        });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        document.getElementById('reply-content').value = '';
        renderThread(id);
      });
    }
  }

  // ---------- 通報モーダル ----------
  const reportModal = document.getElementById('report-modal');
  function openReportModal(replyId) {
    state.reportTargetReplyId = replyId;
    document.getElementById('report-reason').value = '';
    reportModal.classList.remove('hidden');
  }
  document.getElementById('report-cancel').addEventListener('click', () => {
    reportModal.classList.add('hidden');
  });
  document.getElementById('report-submit').addEventListener('click', async () => {
    const reason = document.getElementById('report-reason').value.trim();
    const { error } = await window.sb.rpc('create_report', {
      p_reply_id: state.reportTargetReplyId,
      p_reason: reason,
      p_reporter_token_hash: state.identity.tokenHash,
    });
    if (error) {
      showToast(errorMessage(error));
      return;
    }
    reportModal.classList.add('hidden');
    showToast('通報しました。ご協力ありがとうございます。');
  });

  // ---------- 起動 ----------
  window.addEventListener('hashchange', route);
  loadMe().then(route);
})();
