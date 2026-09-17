// 匿名ID（ブラウザに保存される、ずっと変わらないID）の生成・管理。
// 完全に静的なサイトなのでサーバーには頼らず、localStorageに保存する。
(() => {
  const IDENTITY_KEY = 'board_identity_token_v1';
  // 公開ソースなので「秘密」ではないが、生のトークンをそのままDBに残さないための一手間。
  const SALT = 'board-public-salt-v1';

  function getToken() {
    let t = localStorage.getItem(IDENTITY_KEY);
    if (!t) {
      t = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
      localStorage.setItem(IDENTITY_KEY, t);
    }
    return t;
  }

  async function sha256Hex(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  let cached = null;
  async function getIdentity() {
    if (cached) return cached;
    const token = getToken();
    const hash = await sha256Hex(token + '|' + SALT);
    cached = { tokenHash: hash, displayId: hash.slice(0, 8) };
    return cached;
  }

  window.BoardIdentity = { getIdentity };
})();
