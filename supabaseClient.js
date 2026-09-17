// Supabaseクライアントの初期化（supabase-config.js の値を使う）
window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
