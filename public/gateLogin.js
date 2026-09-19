(() => {
  const SITE_PASSWORD = '108801';
  const GATE_KEY = 'board_gate_ok_v1';

  const input = document.getElementById('password');
  const btn = document.getElementById('submit');
  const errorEl = document.getElementById('error');

  function submit() {
    const password = input.value;
    errorEl.textContent = '';
    if (!password) return;

    if (password === SITE_PASSWORD) {
      sessionStorage.setItem(GATE_KEY, '1');
      location.href = 'index.html';
    } else {
      errorEl.textContent = 'パスワードが違います。';
      input.value = '';
      input.focus();
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
})();
