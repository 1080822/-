(() => {
  const app = document.getElementById('app');
  const myIdEl = document.getElementById('my-id');
  const toastEl = document.getElementById('toast');

  const THEME_KEY = 'board_theme_v1';
  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? 'ライトモード' : 'ダークモード';
  }
  function initTheme() {
    const stored = getStoredTheme();
    const theme =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    applyTheme(theme);
  }
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {}
    });
  }
  initTheme();

  const state = {
    isAdmin: false,
    tab: 'active',
    sortMode: 'new',
    reportTargetReplyId: null,
    identity: null,
  };

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

  const LIKE_TIER_COLORS = [
    '#e0445b',
    '#ff8c42',
    '#c9a400',
    '#43a047',
    '#00acc1',
    '#3d7bfd',
    '#8e5cf7',
    '#e91e8c',
  ];
  function getLikeCountVisual(count) {
    if (!count || count <= 0) return { bold: false, color: '' };
    if (count < 10) return { bold: true, color: '' };
    const tier = Math.floor(count / 10);
    return { bold: true, color: LIKE_TIER_COLORS[(tier - 1) % LIKE_TIER_COLORS.length] };
  }
  function likeCountStyleAttr(count) {
    const v = getLikeCountVisual(count);
    if (!v.bold && !v.color) return '';
    let style = '';
    if (v.bold) style += 'font-weight:700;';
    if (v.color) style += `color:${v.color};`;
    return ` style="${style}"`;
  }
  function applyLikeCountVisual(el, count) {
    const v = getLikeCountVisual(count);
    el.style.fontWeight = v.bold ? '700' : '';
    el.style.color = v.color || '';
  }

  function linkifyRefs(escapedHtml) {
    return escapedHtml.replace(/&gt;&gt;(\d+)/g, (match, num) => {
      return `<a href="#" class="ref-link" data-num="${num}">&gt;&gt;${num}</a>`;
    });
  }

  function linkifyUrls(escapedHtml) {
    return escapedHtml.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
      const m = match.match(/^(.*?)([)\]｝」』。、,.!?！？]*)$/s);
      const url = m ? m[1] : match;
      const trail = m ? m[2] : '';
      if (!url) return match;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
    });
  }

  const youtubeOEmbedCache = new Map();

  function extractYoutubeVideos(rawContent) {
    const re =
      /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=([\w-]+)|shorts\/([\w-]+)|live\/([\w-]+))|youtu\.be\/([\w-]+))[^\s]*/g;
    const results = [];
    const seen = new Set();
    let match;
    while ((match = re.exec(rawContent)) !== null) {
      const videoId = match[1] || match[2] || match[3] || match[4];
      if (!videoId || seen.has(videoId)) continue;
      seen.add(videoId);
      results.push({ originalUrl: match[0], videoId });
    }
    return results;
  }

  async function fetchYoutubeOEmbed(videoId) {
    if (youtubeOEmbedCache.has(videoId)) return youtubeOEmbedCache.get(videoId);
    const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
    const promise = fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watchUrl))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    youtubeOEmbedCache.set(videoId, promise);
    return promise;
  }

  function renderYoutubePreviews(container, rawContent) {
    const videos = extractYoutubeVideos(rawContent);
    for (const { originalUrl, videoId } of videos) {
      const card = document.createElement('a');
      card.className = 'link-preview link-preview-loading';
      card.href = originalUrl;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.textContent = '読み込み中...';
      container.appendChild(card);

      fetchYoutubeOEmbed(videoId).then((data) => {
        card.classList.remove('link-preview-loading');
        if (!data) {
          card.remove();
          return;
        }
        container.querySelectorAll('a:not(.link-preview)').forEach((a) => {
          if (a.href.includes(videoId)) a.style.display = 'none';
        });
        card.innerHTML = `
          <img class="link-preview-thumb" src="${escapeHtml(data.thumbnail_url || '')}" alt="" loading="lazy" />
          <span class="link-preview-title">${escapeHtml(data.title || originalUrl)}</span>
        `;
      });
    }
  }

  const twitterOEmbedCache = new Map();
  let twitterWidgetsPromise = null;

  function loadTwitterWidgetsScript() {
    if (twitterWidgetsPromise) return twitterWidgetsPromise;
    twitterWidgetsPromise = new Promise((resolve) => {
      if (window.twttr && window.twttr.widgets) {
        resolve(window.twttr);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://platform.twitter.com/widgets.js';
      script.async = true;
      script.onload = () => resolve(window.twttr || null);
      script.onerror = () => resolve(null);
      document.body.appendChild(script);
    });
    return twitterWidgetsPromise;
  }

  function extractTweetUrls(rawContent) {
    const re = /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[^\/\s]+\/status\/(\d+)[^\s]*/g;
    const results = [];
    const seen = new Set();
    let match;
    while ((match = re.exec(rawContent)) !== null) {
      const tweetId = match[1];
      if (seen.has(tweetId)) continue;
      seen.add(tweetId);
      results.push({ originalUrl: match[0], tweetId });
    }
    return results;
  }

  async function fetchTweetOEmbed(originalUrl) {
    if (twitterOEmbedCache.has(originalUrl)) return twitterOEmbedCache.get(originalUrl);
    const promise = fetch(
      'https://publish.twitter.com/oembed?omit_script=true&dnt=true&url=' + encodeURIComponent(originalUrl)
    )
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    twitterOEmbedCache.set(originalUrl, promise);
    return promise;
  }

  function renderTweetPreviews(container, rawContent) {
    const tweets = extractTweetUrls(rawContent);
    for (const { originalUrl, tweetId } of tweets) {
      const wrap = document.createElement('div');
      wrap.className = 'tweet-embed-wrap';
      wrap.textContent = '読み込み中...';
      container.appendChild(wrap);

      fetchTweetOEmbed(originalUrl).then(async (data) => {
        if (!data || !data.html) {
          wrap.remove();
          return;
        }
        wrap.innerHTML = data.html;
        const twttr = await loadTwitterWidgetsScript();
        if (twttr && twttr.widgets) {
          twttr.widgets.load(wrap);
        }
        container.querySelectorAll('a:not(.link-preview)').forEach((a) => {
          if (a.href.includes(tweetId)) a.style.display = 'none';
        });
      });
    }
  }

  const threadPreviewCache = new Map();

  function extractInternalThreadLinks(rawContent) {
    const re = /https?:\/\/[^\s<]+/g;
    const results = [];
    const seen = new Set();
    let match;
    while ((match = re.exec(rawContent)) !== null) {
      const m = match[0].match(/^(.*?)([)\]｝」』。、,.!?！？]*)$/s);
      const trimmed = m ? m[1] : match[0];
      let u;
      try {
        u = new URL(trimmed);
      } catch (e) {
        continue;
      }
      const hashMatch = u.hash.match(/^#\/thread\/(\d+)/);
      if (!hashMatch) continue;
      if (u.origin + u.pathname !== location.origin + location.pathname) continue;
      const threadId = Number(hashMatch[1]);
      if (seen.has(threadId)) continue;
      seen.add(threadId);
      results.push({ originalUrl: trimmed, threadId });
    }
    return results;
  }

  async function fetchThreadPreview(threadId) {
    if (threadPreviewCache.has(threadId)) return threadPreviewCache.get(threadId);
    const promise = (async () => {
      const { data: thread } = await window.sb
        .from('threads')
        .select('id, title, is_deleted, thumbnail_path')
        .eq('id', threadId)
        .single();
      if (!thread || thread.is_deleted) return null;
      const { data: firstReply } = await window.sb
        .from('replies')
        .select('content, image_paths')
        .eq('thread_id', threadId)
        .eq('number', 1)
        .single();
      const imagePaths =
        firstReply && Array.isArray(firstReply.image_paths) ? firstReply.image_paths : [];
      const previewImagePath = thread.thumbnail_path || (imagePaths.length > 0 ? imagePaths[0] : null);
      return {
        title: thread.title,
        desc: firstReply ? firstReply.content : '',
        imageUrl: previewImagePath ? getImagePublicUrl(previewImagePath) : null,
      };
    })().catch(() => null);
    threadPreviewCache.set(threadId, promise);
    return promise;
  }

  function renderInternalThreadPreviews(container, rawContent) {
    const links = extractInternalThreadLinks(rawContent);
    for (const { originalUrl, threadId } of links) {
      const card = document.createElement('a');
      card.className = 'thread-preview thread-preview-loading';
      card.href = originalUrl;
      card.textContent = '読み込み中...';
      container.appendChild(card);

      fetchThreadPreview(threadId).then((data) => {
        card.classList.remove('thread-preview-loading');
        if (!data) {
          card.remove();
          return;
        }
        container.querySelectorAll('a:not(.link-preview):not(.thread-preview)').forEach((a) => {
          if (a.href.includes('#/thread/' + threadId)) a.style.display = 'none';
        });
        card.innerHTML = `
          ${
            data.imageUrl
              ? `<img class="thread-preview-thumb" src="${escapeHtml(data.imageUrl)}" alt="" loading="lazy" />`
              : ''
          }
          <div class="thread-preview-body">
            <div class="thread-preview-title">${escapeHtml(data.title)}</div>
            ${
              data.desc
                ? `<div class="thread-preview-desc">${escapeHtml(data.desc)}</div>`
                : ''
            }
            <div class="thread-preview-domain">${escapeHtml(location.host)}</div>
          </div>
        `;
      });
    }
  }

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGES = 4;
  const IMAGE_BUCKET = 'post-images';

  function setupImageAttach(inputId, previewListId, maxCount) {
    const limit = maxCount || MAX_IMAGES;
    const input = document.getElementById(inputId);
    const previewList = document.getElementById(previewListId);
    const holder = { files: [] };

    function render() {
      previewList.innerHTML = '';
      if (holder.files.length === 0) {
        previewList.classList.add('hidden');
        return;
      }
      previewList.classList.remove('hidden');
      holder.files.forEach((file, idx) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';

        const img = document.createElement('img');
        img.alt = '';
        const reader = new FileReader();
        reader.onload = () => {
          img.src = reader.result;
        };
        reader.readAsDataURL(file);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'image-preview-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
          holder.files.splice(idx, 1);
          render();
        });

        item.appendChild(img);
        item.appendChild(removeBtn);
        previewList.appendChild(item);
      });
    }

    input.addEventListener('change', () => {
      const picked = Array.from(input.files || []);
      input.value = '';
      if (limit === 1 && picked.length > 0) {
        holder.files = [];
      }
      for (const file of picked) {
        if (holder.files.length >= limit) {
          showToast(limit === 1 ? '画像は1枚だけ選べます。' : `画像は${limit}枚までです。`);
          break;
        }
        if (!file.type.startsWith('image/')) {
          showToast('画像ファイルを選択してください。');
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          showToast('画像は1枚5MBまでです。');
          continue;
        }
        holder.files.push(file);
      }
      render();
    });

    holder.reset = () => {
      holder.files = [];
      render();
    };

    return holder;
  }

  const COMPRESS_MAX_DIM = 1600;
  const COMPRESS_QUALITY = 0.82;
  const COMPRESS_SKIP_TYPES = ['image/gif'];

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
      img._objectUrl = url;
    });
  }

  async function compressImageIfNeeded(file) {
    try {
      if (COMPRESS_SKIP_TYPES.includes(file.type)) return file;
      if (file.size <= 400 * 1024) return file;
      const img = await loadImageFromFile(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);
      if (w <= COMPRESS_MAX_DIM && h <= COMPRESS_MAX_DIM) return file;
      const scale = COMPRESS_MAX_DIM / Math.max(w, h);
      const targetW = Math.max(1, Math.round(w * scale));
      const targetH = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, outType, COMPRESS_QUALITY));
      if (!blob || blob.size >= file.size) return file;
      const newName =
        outType === 'image/jpeg' && !/\.jpe?g$/i.test(file.name)
          ? file.name.replace(/\.[a-zA-Z0-9]+$/, '') + '.jpg'
          : file.name;
      return new File([blob], newName, { type: outType });
    } catch (e) {
      return file;
    }
  }

  async function uploadImages(rawFiles) {
    if (!rawFiles || rawFiles.length === 0) return null;
    const files = await Promise.all(rawFiles.map(compressImageIfNeeded));
    const now = Date.now();
    const uploads = files.map((file, i) => {
      const extMatch = /\.([a-zA-Z0-9]+)$/.exec(file.name || '');
      const ext = (extMatch ? extMatch[1] : 'jpg').toLowerCase();
      const path = `${now}-${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      return window.sb.storage
        .from(IMAGE_BUCKET)
        .upload(path, file)
        .then(({ error }) => {
          if (error) throw error;
          return path;
        });
    });
    try {
      return await Promise.all(uploads);
    } catch (e) {
      showToast('画像のアップロードに失敗しました。');
      throw e;
    }
  }

  function getImagePublicUrl(path) {
    if (!path) return null;
    const { data } = window.sb.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return data && data.publicUrl;
  }

  const lightboxEl = document.getElementById('lightbox');
  const lightboxImgEl = document.getElementById('lightbox-img');
  function openLightbox(src) {
    lightboxImgEl.src = src;
    lightboxEl.classList.remove('hidden');
  }
  function closeLightbox() {
    lightboxEl.classList.add('hidden');
    lightboxImgEl.src = '';
  }
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightboxEl.classList.contains('hidden')) closeLightbox();
  });
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.reply-images img');
    if (img) {
      e.preventDefault();
      openLightbox(img.src);
    }
  });

  const refPreviewEl = document.createElement('div');
  refPreviewEl.className = 'ref-preview hidden';
  document.body.appendChild(refPreviewEl);

  function hideRefPreview() {
    refPreviewEl.classList.add('hidden');
  }

  function showRefPreviewFor(linkEl, reply) {
    if (!reply) {
      hideRefPreview();
      return;
    }
    const bodyText = reply.is_deleted ? '（このレスは削除されました）' : reply.content || '';
    const snippet = bodyText.length > 200 ? bodyText.slice(0, 200) + '…' : bodyText;
    const hasImage = !reply.is_deleted && Array.isArray(reply.image_paths) && reply.image_paths.length > 0;
    refPreviewEl.innerHTML = `
      <div class="ref-preview-head">
        <span class="reply-number">${reply.number}</span>
        <span class="reply-id">ID:${escapeHtml(reply.author_id || '')}</span>
      </div>
      <div class="ref-preview-body">${nl2br(escapeHtml(snippet))}</div>
      ${
        hasImage
          ? `<img class="ref-preview-thumb" src="${escapeHtml(getImagePublicUrl(reply.image_paths[0]))}" alt="" />`
          : ''
      }
    `;
    refPreviewEl.classList.remove('hidden');

    const rect = linkEl.getBoundingClientRect();
    const previewWidthGuess = 300;
    let left = rect.left;
    if (left + previewWidthGuess > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - previewWidthGuess - 8);
    }
    refPreviewEl.style.left = left + 'px';
    refPreviewEl.style.top = rect.bottom + 6 + 'px';
    requestAnimationFrame(() => {
      if (refPreviewEl.classList.contains('hidden')) return;
      const previewRect = refPreviewEl.getBoundingClientRect();
      if (previewRect.bottom > window.innerHeight - 8) {
        refPreviewEl.style.top = Math.max(8, rect.top - previewRect.height - 6) + 'px';
      }
    });
  }

  window.addEventListener('scroll', hideRefPreview, true);
  window.addEventListener('hashchange', hideRefPreview);

  let activeReplyChannel = null;
  function unsubscribeReplyChannel() {
    if (activeReplyChannel) {
      window.sb.removeChannel(activeReplyChannel);
      activeReplyChannel = null;
    }
  }

  let pendingScrollToReplyNumber = null;
  function scrollToPendingReply() {
    if (pendingScrollToReplyNumber == null) return;
    const num = pendingScrollToReplyNumber;
    pendingScrollToReplyNumber = null;
    const target = document.getElementById('reply-' + num);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('highlight');
    setTimeout(() => target.classList.remove('highlight'), 1600);
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
      rate_limited: '連続投稿はできません。少し時間をおいてからもう一度お試しください。',
    };
    const msg = err && err.message;
    return map[msg] || 'エラーが発生しました。';
  }

  let lastPostAt = 0;
  function checkCooldown() {
    const now = Date.now();
    if (now - lastPostAt < 4000) return false;
    lastPostAt = now;
    return true;
  }

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
    unsubscribeReplyChannel();
    const r = currentRoute();
    if (r.name === 'thread') {
      await renderThread(r.id);
    } else {
      await renderList();
    }
  }

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

    app.querySelectorAll('.sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sort === state.sortMode);
      btn.addEventListener('click', () => {
        state.sortMode = btn.dataset.sort;
        renderList();
      });
    });

    const newThreadBtn = document.getElementById('new-thread-btn');
    const form = document.getElementById('new-thread-form');
    const newThreadThumbnail = setupImageAttach('new-thread-thumbnail', 'new-thread-thumbnail-preview', 1);
    const newThreadImage = setupImageAttach('new-thread-image', 'new-thread-image-preview');
    newThreadBtn.addEventListener('click', () => form.classList.toggle('hidden'));
    document.getElementById('new-thread-cancel').addEventListener('click', () => {
      form.classList.add('hidden');
      newThreadThumbnail.reset();
      newThreadImage.reset();
    });
    document.getElementById('new-thread-submit').addEventListener('click', async () => {
      const title = document.getElementById('new-thread-title').value.trim();
      const content = document.getElementById('new-thread-content').value.trim();
      if (!title || (!content && newThreadImage.files.length === 0)) {
        showToast('タイトルと本文（または画像）を入力してください。');
        return;
      }
      if (!checkCooldown()) {
        showToast('連続投稿はできません。少し待ってから試してください。');
        return;
      }
      const submitBtn = document.getElementById('new-thread-submit');
      const submitBtnOriginalText = submitBtn.textContent;
      submitBtn.disabled = true;
      let imagePaths = null;
      let thumbnailPath = null;
      try {
        if (newThreadThumbnail.files.length > 0 || newThreadImage.files.length > 0) {
          submitBtn.textContent = '画像アップロード中...';
        }
        if (newThreadThumbnail.files.length > 0) {
          const uploaded = await uploadImages(newThreadThumbnail.files);
          thumbnailPath = uploaded ? uploaded[0] : null;
        }
        if (newThreadImage.files.length > 0) {
          imagePaths = await uploadImages(newThreadImage.files);
        }
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtnOriginalText;
        return;
      }
      submitBtn.textContent = '送信中...';
      const { data, error } = await window.sb.rpc('create_thread', {
        p_title: title,
        p_content: content,
        p_author_id: state.identity.displayId,
        p_author_token_hash: state.identity.tokenHash,
        p_image_paths: imagePaths,
        p_thumbnail_path: thumbnailPath,
      });
      if (error) {
        showToast(errorMessage(error));
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtnOriginalText;
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
          .sort((a, b) => b.created_at - a.created_at);
      } else {
        const { data, error } = await window.sb
          .from('threads')
          .select('*')
          .eq('is_deleted', false)
          .eq('is_archived', state.tab === 'archived')
          .order('created_at', { ascending: false });
        if (error) throw error;
        threads = data || [];
      }
    } catch (err) {
      listEl.innerHTML = '';
      showToast('スレッド一覧の取得に失敗しました。');
      return;
    }

    if (state.sortMode === 'ikioi') {
      threads.sort((a, b) => b.last_reply_at - a.last_reply_at);
    } else {
      threads.sort((a, b) => b.created_at - a.created_at);
    }

    listEl.innerHTML = '';
    if (threads.length === 0) {
      emptyEl.classList.remove('hidden');
      emptyEl.textContent = 'スレッドはまだありません。';
      return;
    }
    emptyEl.classList.add('hidden');

    for (const t of threads) {
      const li = document.createElement('li');
      li.className = 'thread-item';
      const bookmarked = isBookmarked(t.id);
      const thumbnailUrl = t.thumbnail_path ? getImagePublicUrl(t.thumbnail_path) : null;
      li.innerHTML = `
        ${
          thumbnailUrl
            ? `<a class="thread-item-thumb-link" href="#/thread/${t.id}"><img class="thread-item-thumb" src="${escapeHtml(
                thumbnailUrl
              )}" alt="" loading="lazy" /></a>`
            : ''
        }
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

  function buildReplyEl(r, likedByMe) {
    const li = document.createElement('li');
    li.id = 'reply-' + r.number;
    li.className = 'reply-item' + (r.is_deleted ? ' deleted' : '');
    const content = r.is_deleted ? '（このレスは削除されました）' : r.content;
    const bodyHtml = r.is_deleted
      ? escapeHtml(content)
      : nl2br(linkifyRefs(linkifyUrls(escapeHtml(content))));
    const isOwnReply = r.author_token_hash === state.identity.tokenHash;
    const canDelete = state.isAdmin || isOwnReply;
    const imageUrls =
      !r.is_deleted && Array.isArray(r.image_paths) && r.image_paths.length > 0
        ? r.image_paths.map(getImagePublicUrl)
        : [];
    li.innerHTML = `
      <div class="reply-item-head">
        <span class="reply-number">${r.number}</span>
        <span class="reply-id">ID:${escapeHtml(r.author_id)}</span>
        <span>${formatDate(r.created_at)}</span>
      </div>
      <div class="reply-body"${likeCountStyleAttr(r.is_deleted ? 0 : r.like_count)}>${bodyHtml}</div>
      ${
        imageUrls.length > 0
          ? `<div class="reply-images">${imageUrls
              .map(
                (u) =>
                  `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(
                    u
                  )}" alt="添付画像" loading="lazy" /></a>`
              )
              .join('')}</div>`
          : ''
      }
      ${r.is_deleted ? '' : `<div class="reply-backrefs hidden" id="backrefs-${r.number}"></div>`}
      ${
        r.is_deleted
          ? ''
          : `<div class="reply-actions">
              <button class="like-btn ${likedByMe ? 'liked' : ''}" data-id="${r.id}">
                <span class="heart">♡</span><span class="like-count">${r.like_count}</span>
              </button>
              <button class="quote-link" data-num="${r.number}">返信</button>
              <button class="report-link" data-id="${r.id}">通報</button>
              ${
                canDelete
                  ? `<button class="delete-link" data-id="${r.id}">レス削除</button>`
                  : ''
              }
            </div>`
      }
    `;
    if (!r.is_deleted) {
      renderYoutubePreviews(li.querySelector('.reply-body'), r.content);
      renderTweetPreviews(li.querySelector('.reply-body'), r.content);
      renderInternalThreadPreviews(li.querySelector('.reply-body'), r.content);
    }
    return li;
  }

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
      レス数 <span id="reply-count-num">${thread.reply_count}</span>　<span id="thread-archived-badge" class="archived-badge${
      thread.is_archived ? '' : ' hidden'
    }">過去スレ</span>
      ${canDeleteThread ? ' 　<button class="delete-link" id="delete-thread-btn">このスレッドを削除</button>' : ''}
    `;

    const repliesById = new Map();
    const repliesByNumber = new Map();
    for (const r of replies || []) {
      repliesById.set(r.id, r);
      repliesByNumber.set(r.number, r);
    }

    const backrefsByNumber = new Map();
    function extractBackrefTargets(rawContent) {
      const re = />>(\d+)/g;
      const nums = new Set();
      let m;
      while ((m = re.exec(rawContent)) !== null) nums.add(Number(m[1]));
      return [...nums];
    }
    function addBackref(targetNumber, fromNumber) {
      if (targetNumber === fromNumber) return;
      if (!backrefsByNumber.has(targetNumber)) backrefsByNumber.set(targetNumber, []);
      const arr = backrefsByNumber.get(targetNumber);
      if (!arr.includes(fromNumber)) arr.push(fromNumber);
    }
    function updateBackrefsEl(number) {
      const el = document.getElementById('backrefs-' + number);
      if (!el) return;
      const nums = backrefsByNumber.get(number) || [];
      if (nums.length === 0) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('hidden');
      el.innerHTML =
        '↩ ' + nums.map((n) => `<a href="#" class="ref-link" data-num="${n}">&gt;&gt;${n}</a>`).join(' ');
    }
    for (const r of replies || []) {
      if (r.is_deleted) continue;
      for (const t of extractBackrefTargets(r.content)) addBackref(t, r.number);
    }

    if (canDeleteThread) {
      document.getElementById('delete-thread-btn').addEventListener('click', async () => {
        if (!(await askConfirm('このスレッドを削除します。よろしいですか？'))) return;
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
      const likedByMe = likedIds.includes(r.id);
      replyList.appendChild(buildReplyEl(r, likedByMe));
    }
    for (const number of backrefsByNumber.keys()) updateBackrefsEl(number);

    function insertQuote(num) {
      const textarea = document.getElementById('reply-content');
      if (!textarea) return;
      const prefix = textarea.value && !textarea.value.endsWith('\n') ? '\n' : '';
      textarea.value += `${prefix}>>${num}\n`;
      textarea.focus();
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    replyList.addEventListener('click', async (e) => {
      const likeBtn = e.target.closest('.like-btn');
      if (likeBtn) {
        const { data, error } = await window.sb.rpc('toggle_like', {
          p_reply_id: Number(likeBtn.dataset.id),
          p_user_token_hash: state.identity.tokenHash,
        });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        const row = data[0];
        likeBtn.classList.toggle('liked', row.liked);
        const countEl = likeBtn.querySelector('.like-count');
        countEl.textContent = row.like_count;
        const replyBodyEl = likeBtn.closest('.reply-item')?.querySelector('.reply-body');
        if (replyBodyEl) applyLikeCountVisual(replyBodyEl, row.like_count);
        return;
      }

      const quoteBtn = e.target.closest('.quote-link');
      if (quoteBtn) {
        insertQuote(quoteBtn.dataset.num);
        return;
      }

      const reportBtn = e.target.closest('.report-link');
      if (reportBtn) {
        openReportModal(Number(reportBtn.dataset.id));
        return;
      }

      const deleteBtn = e.target.closest('.delete-link');
      if (deleteBtn) {
        if (!(await askConfirm('このレスを削除します。よろしいですか？'))) return;
        const replyId = Number(deleteBtn.dataset.id);
        const { error } = await window.sb.rpc('delete_reply', {
          p_reply_id: replyId,
          p_requester_token_hash: state.identity.tokenHash,
        });
        if (error) {
          showToast(errorMessage(error));
          return;
        }
        renderThread(id);
        return;
      }

      const refLink = e.target.closest('.ref-link');
      if (refLink) {
        e.preventDefault();
        const target = document.getElementById('reply-' + refLink.dataset.num);
        if (!target) {
          showToast('そのレス番号は見つかりませんでした。');
          return;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('highlight');
        setTimeout(() => target.classList.remove('highlight'), 1600);
      }
    });

    replyList.addEventListener('mouseover', (e) => {
      const link = e.target.closest('.ref-link');
      if (!link) return;
      const num = Number(link.dataset.num);
      showRefPreviewFor(link, repliesByNumber.get(num));
    });
    replyList.addEventListener('mouseout', (e) => {
      const link = e.target.closest('.ref-link');
      if (!link) return;
      if (e.relatedTarget && link.contains(e.relatedTarget)) return;
      hideRefPreview();
    });

    scrollToPendingReply();

    const replyForm = document.getElementById('reply-form');
    const archivedMsg = document.getElementById('archived-msg');
    if (thread.is_archived) {
      replyForm.classList.add('hidden');
      archivedMsg.classList.remove('hidden');
    } else {
      replyForm.classList.remove('hidden');
      archivedMsg.classList.add('hidden');
      const replyImage = setupImageAttach('reply-image', 'reply-image-preview');
      document.getElementById('reply-submit').addEventListener('click', async () => {
        const content = document.getElementById('reply-content').value.trim();
        if (!content && replyImage.files.length === 0) {
          showToast('本文または画像を入力してください。');
          return;
        }
        if (!checkCooldown()) {
          showToast('連続投稿はできません。少し待ってから試してください。');
          return;
        }
        const submitBtn = document.getElementById('reply-submit');
        const submitBtnOriginalText = submitBtn.textContent;
        submitBtn.disabled = true;
        let imagePaths = null;
        try {
          if (replyImage.files.length > 0) {
            submitBtn.textContent = '画像アップロード中...';
            imagePaths = await uploadImages(replyImage.files);
          }
        } catch (e) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtnOriginalText;
          return;
        }
        submitBtn.textContent = '送信中...';
        const { error } = await window.sb.rpc('add_reply', {
          p_thread_id: id,
          p_content: content,
          p_author_id: state.identity.displayId,
          p_author_token_hash: state.identity.tokenHash,
          p_image_paths: imagePaths,
        });
        if (error) {
          showToast(errorMessage(error));
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtnOriginalText;
          return;
        }
        document.getElementById('reply-content').value = '';
        renderThread(id);
      });
    }

    function appendIncomingReply(r) {
      if (!r || repliesById.has(r.id) || document.getElementById('reply-' + r.number)) return;
      repliesById.set(r.id, r);
      repliesByNumber.set(r.number, r);
      replyList.appendChild(buildReplyEl(r, false));
      if (!r.is_deleted) {
        for (const t of extractBackrefTargets(r.content)) {
          addBackref(t, r.number);
          updateBackrefsEl(t);
        }
      }

      const countEl = document.getElementById('reply-count-num');
      if (countEl) countEl.textContent = String(r.number);
      if (r.number >= 1000) {
        replyForm.classList.add('hidden');
        archivedMsg.classList.remove('hidden');
        const badge = document.getElementById('thread-archived-badge');
        if (badge) badge.classList.remove('hidden');
      }
    }

    activeReplyChannel = window.sb
      .channel('replies-thread-' + id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'replies', filter: `thread_id=eq.${id}` },
        (payload) => appendIncomingReply(payload.new)
      )
      .subscribe();
  }

  const confirmModalEl = document.getElementById('confirm-modal');
  const confirmModalMessageEl = document.getElementById('confirm-modal-message');
  let confirmModalResolve = null;
  function askConfirm(message) {
    return new Promise((resolve) => {
      confirmModalMessageEl.textContent = message;
      confirmModalResolve = resolve;
      confirmModalEl.classList.remove('hidden');
    });
  }
  function closeConfirmModal(result) {
    confirmModalEl.classList.add('hidden');
    if (confirmModalResolve) {
      confirmModalResolve(result);
      confirmModalResolve = null;
    }
  }
  document.getElementById('confirm-modal-cancel').addEventListener('click', () => closeConfirmModal(false));
  document.getElementById('confirm-modal-ok').addEventListener('click', () => closeConfirmModal(true));
  confirmModalEl.addEventListener('click', (e) => {
    if (e.target === confirmModalEl) closeConfirmModal(false);
  });

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

  const globalSearchInput = document.getElementById('global-search-input');
  const globalSearchResults = document.getElementById('global-search-results');
  let searchMode = 'thread';
  let searchDebounceTimer = null;
  let searchRequestSeq = 0;

  function hideSearchResults() {
    globalSearchResults.classList.add('hidden');
    globalSearchResults.innerHTML = '';
  }

  function goToSearchResultThread(threadId) {
    hideSearchResults();
    globalSearchInput.value = '';
    location.hash = '#/thread/' + threadId;
  }

  function goToSearchResultReply(threadId, number) {
    hideSearchResults();
    globalSearchInput.value = '';
    pendingScrollToReplyNumber = number;
    const targetHash = '#/thread/' + threadId;
    if (location.hash === targetHash) {
      scrollToPendingReply();
    } else {
      location.hash = targetHash;
    }
  }

  async function runGlobalSearch() {
    const q = globalSearchInput.value.trim();
    if (!q) {
      hideSearchResults();
      return;
    }
    const seq = ++searchRequestSeq;
    globalSearchResults.classList.remove('hidden');
    globalSearchResults.innerHTML = '<div class="search-empty">検索中...</div>';

    if (searchMode === 'thread') {
      const { data, error } = await window.sb
        .from('threads')
        .select('*')
        .eq('is_deleted', false)
        .ilike('title', `%${q}%`)
        .order('last_reply_at', { ascending: false })
        .limit(20);
      if (seq !== searchRequestSeq) return;
      if (error || !data || data.length === 0) {
        globalSearchResults.innerHTML = '<div class="search-empty">一致するスレッドが見つかりません。</div>';
        return;
      }
      globalSearchResults.innerHTML = '';
      for (const t of data) {
        const a = document.createElement('a');
        a.href = '#/thread/' + t.id;
        a.className = 'search-result-item';
        a.innerHTML = `
          <div class="search-result-title">${escapeHtml(t.title)}</div>
          <div class="search-result-meta">レス数 ${t.reply_count}　最終レス: ${formatDate(t.last_reply_at)}</div>
        `;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          goToSearchResultThread(t.id);
        });
        globalSearchResults.appendChild(a);
      }
    } else {
      const { data, error } = await window.sb
        .from('replies')
        .select('*, threads(title, is_deleted)')
        .eq('is_deleted', false)
        .ilike('content', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(20);
      if (seq !== searchRequestSeq) return;
      const filtered = (data || []).filter((r) => r.threads && !r.threads.is_deleted);
      if (error || filtered.length === 0) {
        globalSearchResults.innerHTML = '<div class="search-empty">一致するレスが見つかりません。</div>';
        return;
      }
      globalSearchResults.innerHTML = '';
      for (const r of filtered) {
        const snippet = r.content.length > 80 ? r.content.slice(0, 80) + '…' : r.content;
        const a = document.createElement('a');
        a.href = '#/thread/' + r.thread_id;
        a.className = 'search-result-item';
        a.innerHTML = `
          <div class="search-result-title">${escapeHtml(r.threads.title)}　<span style="font-weight:400;color:var(--text-muted);">#${r.number}</span></div>
          <div class="search-result-snippet">${escapeHtml(snippet)}</div>
        `;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          goToSearchResultReply(r.thread_id, r.number);
        });
        globalSearchResults.appendChild(a);
      }
    }
  }

  document.querySelectorAll('.search-mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      searchMode = btn.dataset.mode;
      document.querySelectorAll('.search-mode-tab').forEach((b) => b.classList.toggle('active', b === btn));
      globalSearchInput.placeholder = searchMode === 'thread' ? 'スレッドのタイトルを検索' : 'レスの本文を検索';
      if (globalSearchInput.value.trim()) {
        runGlobalSearch();
      } else {
        hideSearchResults();
      }
    });
  });

  globalSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(runGlobalSearch, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search')) {
      hideSearchResults();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSearchResults();
  });

  window.addEventListener('hashchange', route);
  loadMe().then(route);
})();
