// 管理者ページのロジック。
// Node.jsサーバーは使わないので、「本当に管理者かどうか」はSupabase Authのログインだけで判定する。
// （gate.htmlの「108100308」はこのページへの入口を開くだけで、実際の管理者権限は付与しない）
(() => {
  const app = document.getElementById('app');
  const statusEl = document.getElementById('admin-status');
  const toastEl = document.getElementById('toast');

  const state = {
    tab: 'pending', // pending | resolved | bans
  };

  const IMAGE_BUCKET = 'post-images';
  // レス削除時に添付画像もStorageから消す。失敗してもレス自体の削除は既に完了しているので、
  // コンソールに記録するだけにする（利用者への通知は不要）。
  async function deleteImagesFromStorage(paths) {
    const list = (paths || []).filter(Boolean);
    if (list.length === 0) return;
    try {
      await window.sb.storage.from(IMAGE_BUCKET).remove(list);
    } catch (e) {
      console.error('画像の削除に失敗しました', e);
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(ts) {
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  function errorMessage(err) {
    const map = {
      admin_only: '管理者としてログインしていません。',
      not_found: '見つかりませんでした（既に削除された可能性があります）。',
    };
    const msg = err && err.message;
    return map[msg] || 'エラーが発生しました。';
  }

  async function boot() {
    const { data, error } = await window.sb.auth.getSession();
    if (error) {
      console.error(error);
    }
    if (data && data.session) {
      statusEl.textContent = 'ログイン中: ' + (data.session.user.email || '');
      renderDashboard();
    } else {
      statusEl.textContent = '未ログイン';
      renderLogin();
    }
  }

  function renderLogin() {
    // gate.html側で108100308入力時に自動ログインする仕組みのため、
    // ここに来るのは自動ログインが行われていない（＝gate.htmlを通っていない、
    // またはセッションが切れた）場合のみ。入力フォームは出さず、入口に戻す。
    app.innerHTML = `
      <div class="login-box">
        <h3>ログインしていません</h3>
        <p class="hint">パスワード入力からやり直してください（108100308を入力すると管理者として開きます）。</p>
        <a class="btn btn-primary" href="gate.html" style="display:block;text-align:center;width:100%;box-sizing:border-box;text-decoration:none;">パスワード入力へ戻る</a>
      </div>
    `;
  }

  async function renderDashboard() {
    app.innerHTML = `
      <div class="topbar">
        <div class="admin-tabs">
          <button class="tab" data-tab="pending">未対応の通報</button>
          <button class="tab" data-tab="resolved">対応済みの通報</button>
          <button class="tab" data-tab="bans">BAN一覧</button>
        </div>
        <button class="btn" id="logout-btn">ログアウト</button>
      </div>
      <div id="admin-content"></div>
    `;
    app.querySelectorAll('.tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
      btn.addEventListener('click', () => {
        state.tab = btn.dataset.tab;
        renderDashboard();
      });
    });
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await window.sb.auth.signOut();
      boot();
    });

    const content = document.getElementById('admin-content');
    if (state.tab === 'bans') {
      await renderBans(content);
    } else {
      await renderReports(content, state.tab);
    }
  }

  async function renderReports(content, status) {
    content.innerHTML = '読み込み中...';

    const { data: reports, error } = await window.sb
      .from('reports')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) {
      content.innerHTML = '取得に失敗しました。';
      showToast(errorMessage(error));
      return;
    }
    if (!reports || reports.length === 0) {
      content.innerHTML = '<p class="empty-msg">通報はありません。</p>';
      return;
    }

    // reportsテーブルには外部キーが無いため、レス・スレッドの情報は別クエリでまとめて取得して手元で結合する。
    const replyIds = [...new Set(reports.map((r) => r.reply_id))];
    const threadIds = [...new Set(reports.map((r) => r.thread_id))];

    const [{ data: replies }, { data: threads }] = await Promise.all([
      window.sb.from('replies').select('*').in('id', replyIds),
      window.sb.from('threads').select('id,title,is_deleted').in('id', threadIds),
    ]);

    const replyById = new Map((replies || []).map((r) => [r.id, r]));
    const threadById = new Map((threads || []).map((t) => [t.id, t]));

    content.innerHTML = '';
    for (const r of reports) {
      const reply = replyById.get(r.reply_id);
      const thread = threadById.get(r.thread_id);

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-head">
          <span>${thread ? escapeHtml(thread.title) : '（スレッド不明）'}${
        thread && thread.is_deleted ? '（スレッド削除済み）' : ''
      } / レス#${r.reply_id}${reply ? ' / ID:' + escapeHtml(reply.author_id) : ''}</span>
          <span>通報日時: ${formatDate(r.created_at)}</span>
        </div>
        <div class="card-body">${
          !reply || reply.is_deleted ? '（このレスは既に削除されています）' : escapeHtml(reply.content)
        }</div>
        ${
          r.reason
            ? `<div class="reason-tag">通報理由: ${escapeHtml(r.reason)}</div>`
            : '<div class="reason-tag" style="color:var(--text-muted)">理由なし</div>'
        }
        <div class="card-actions">
          <a class="btn btn-small" href="index.html#/thread/${r.thread_id}" target="_blank">スレッドを見る</a>
          ${
            status === 'pending'
              ? `
            <button class="btn btn-small" data-action="delete-reply" data-id="${r.reply_id}">このレスを削除</button>
            <button class="btn btn-small btn-danger" data-action="ban" data-id="${r.reply_id}">投稿者をBAN</button>
            <button class="btn btn-small" data-action="resolve" data-id="${r.id}">対応済みにする</button>
          `
              : ''
          }
        </div>
      `;
      content.appendChild(card);
    }

    content.querySelectorAll('[data-action="delete-reply"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('このレスを削除します。よろしいですか？')) return;
        const replyId = Number(btn.dataset.id);
        const target = replyById.get(replyId);
        const { error } = await window.sb.rpc('admin_delete_reply', { p_reply_id: replyId });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        if (target && Array.isArray(target.image_paths)) {
          deleteImagesFromStorage(target.image_paths);
        }
        showToast('削除しました。');
        renderDashboard();
      })
    );
    content.querySelectorAll('[data-action="ban"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        if (!confirm('この投稿者をBANします。よろしいですか？')) return;
        const { error } = await window.sb.rpc('admin_ban_by_reply', {
          p_reply_id: Number(btn.dataset.id),
          p_reason: '通報対応',
        });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        showToast('BANしました。');
        renderDashboard();
      })
    );
    content.querySelectorAll('[data-action="resolve"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const { error } = await window.sb.rpc('admin_resolve_report', { p_report_id: Number(btn.dataset.id) });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        showToast('対応済みにしました。');
        renderDashboard();
      })
    );
  }

  async function renderBans(content) {
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><span>手動でBANを追加</span></div>
        <input type="text" id="manual-token" placeholder="匿名IDのハッシュ（トークン）" style="width:100%;margin-bottom:6px;padding:6px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;" />
        <input type="text" id="manual-reason" placeholder="理由 ※任意" style="width:100%;margin-bottom:6px;padding:6px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;" />
        <button class="btn btn-danger btn-small" id="manual-ban-submit">BANする</button>
        <p class="hint">通常は通報一覧の「投稿者をBAN」から行うのが簡単です。この欄は特殊な場合用です（IPでのBANは静的サイトの仕組み上行えません）。</p>
      </div>
      <div id="ban-list">読み込み中...</div>
    `;
    document.getElementById('manual-ban-submit').addEventListener('click', async () => {
      const tokenHash = document.getElementById('manual-token').value.trim();
      const reason = document.getElementById('manual-reason').value.trim();
      if (!tokenHash) {
        showToast('トークンを入力してください。');
        return;
      }
      const { error } = await window.sb.rpc('admin_ban_token', { p_token_hash: tokenHash, p_reason: reason });
      if (error) {
        showToast(errorMessage(error));
        return;
      }
      showToast('BANしました。');
      renderDashboard();
    });

    const listEl = document.getElementById('ban-list');
    const { data: bans, error } = await window.sb
      .from('bans')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = '取得に失敗しました。';
      showToast(errorMessage(error));
      return;
    }
    if (!bans || bans.length === 0) {
      listEl.innerHTML = '<p class="empty-msg">BAN中のユーザーはいません。</p>';
      return;
    }
    listEl.innerHTML = '';
    for (const b of bans) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-head"><span>BAN日時: ${formatDate(b.created_at)}</span></div>
        <div class="card-body">
          ${b.token_hash ? 'トークン: ' + escapeHtml(b.token_hash.slice(0, 16)) + '...<br>' : ''}
          理由: ${escapeHtml(b.reason || 'なし')}
        </div>
        <div class="card-actions">
          <button class="btn btn-small" data-action="unban" data-id="${b.id}">BAN解除</button>
        </div>
      `;
      listEl.appendChild(card);
    }
    listEl.querySelectorAll('[data-action="unban"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const { error } = await window.sb.rpc('admin_unban', { p_ban_id: Number(btn.dataset.id) });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        showToast('解除しました。');
        renderDashboard();
      })
    );
  }

  boot();
})();
