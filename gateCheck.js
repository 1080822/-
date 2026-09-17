// index.html / admin.html の先頭で読み込む。パスワード未入力ならgate.htmlへ飛ばす。
(() => {
  const GATE_KEY = 'board_gate_ok_v1';
  if (sessionStorage.getItem(GATE_KEY) !== '1') {
    location.replace('gate.html');
  }
})();
