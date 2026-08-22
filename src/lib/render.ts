/**
 * Shared HTML rendering logic for the viewer, used by BOTH:
 *   - src/viewer.ts (local/LAN Node http server)
 *   - api/*.ts (Vercel serverless functions — public, no auth)
 * so the two deployment targets never drift apart.
 */
import { getPool } from "./db.js";
import { searchSongs } from "./search.js";

export { requireAuth, isAuthenticated } from "./auth.js";

/**
 * HTTP Basic Auth check — only used by src/viewer.ts (local/LAN), and only
 * enforced when VIEWER_PASSWORD is set there. Unrelated to the multi-user
 * accounts (auth.ts) used by the public Vercel deployment.
 */
export function isAuthorized(authHeader: string | undefined): boolean {
  const password = process.env.VIEWER_PASSWORD;
  if (!password) return true; // auth disabled — local/LAN-only usage

  const username = process.env.VIEWER_USERNAME || "admin";
  if (!authHeader?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf-8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  return decoded.slice(0, separatorIndex) === username && decoded.slice(separatorIndex + 1) === password;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a lyric line, wrapping [Chord] tags in a tappable pill. `data-chord`
 * holds the ORIGINAL (untransposed) chord — transposeAll() in the client
 * script recomputes displayed text from this on every +/- click, so
 * repeated transposing never drifts.
 */
function renderChordLine(line: string): string {
  if (line === "") return "&nbsp;";
  const parts = line.split(/(\[[^\]]+\])/g);
  return parts
    .map((part) => {
      const m = part.match(/^\[([^\]]+)\]$/);
      if (!m) return escapeHtml(part);
      const chord = escapeHtml(m[1]);
      return `<span class="chord" data-chord="${chord}" onclick="showChordDialog(this.textContent)">${chord}</span>`;
    })
    .join("");
}

const STYLE = `
  :root {
    color-scheme: dark;
    --bg: #0e1013;
    --surface: #191c22;
    --surface-2: #21252d;
    --border: #2a2f39;
    --text: #f1f2f4;
    --text-dim: #8b92a3;
    --accent: #ff9d52;
    --accent-dim: #4a3420;
    --green: #4ade9a;
    --green-dim: #17321f;
    --red: #ff7b8a;
    --red-dim: #3a1a20;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding-bottom: max(24px, env(safe-area-inset-bottom));
  }
  a { color: var(--accent); text-decoration: none; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 0 16px; }

  header.topbar {
    position: sticky; top: 0; z-index: 10;
    background: rgba(14,16,19,0.92); backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
    padding: max(12px, env(safe-area-inset-top)) 16px 12px;
  }
  header.topbar .inner { max-width: 640px; margin: 0 auto; }
  .topbar-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .brand { font-size: 1.15rem; font-weight: 800; color: var(--text); }
  .brand span { color: var(--accent); }
  .logout-link { color: var(--text-dim); font-size: 0.82rem; }
  .logout-link:hover { color: var(--red); }

  form.search { display: flex; gap: 8px; }
  form.search input[type=text] {
    flex: 1; min-width: 0; background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    padding: 12px 14px; border-radius: 10px; font-size: 1rem;
  }
  form.search input[type=text]:focus { outline: none; border-color: var(--accent); }
  form.search button {
    background: var(--accent); color: #1a0f04; border: none; font-weight: 700;
    padding: 0 18px; border-radius: 10px; font-size: 1rem; cursor: pointer; min-height: 44px;
  }

  main.content { padding: 20px 0 40px; }
  h1 { font-size: 1.5rem; margin: 4px 0 4px; line-height: 1.25; }
  .subtitle { color: var(--text-dim); font-size: 0.9rem; margin: 0 0 18px; }
  .hint { background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); font-size: 0.85rem; padding: 10px 14px; border-radius: 10px; margin: -6px 0 16px; }
  .back { display: inline-flex; align-items: center; gap: 4px; color: var(--text-dim); font-size: 0.9rem; margin-bottom: 14px; }
  .back:hover { color: var(--text); }

  ul.songs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  ul.songs li {
    display: flex; align-items: center; gap: 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 14px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25);
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  ul.songs li:active { transform: scale(0.99); }
  ul.songs li > div:first-child { flex: 1; min-width: 0; }
  ul.songs .title-link { font-size: 1.02rem; font-weight: 600; color: var(--text); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul.songs .artist { color: var(--text-dim); font-size: 0.85rem; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--text-dim); text-align: center; padding: 40px 20px; }

  .tag { display: inline-block; font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; margin-top: 6px; }
  .tag.in-db { background: var(--green-dim); color: var(--green); }
  .tag.not-in-db { background: var(--accent-dim); color: var(--accent); }

  button.btn-del, button.btn-crawl {
    border: none; border-radius: 10px; cursor: pointer; font-weight: 700; font-size: 0.85rem;
    min-height: 40px; padding: 0 14px; flex-shrink: 0;
  }
  .btn-del { background: var(--red-dim); color: var(--red); }
  .btn-crawl { background: var(--green-dim); color: var(--green); }
  .btn-crawl.loading { opacity: 0.75; cursor: wait; }
  .btn-crawl.loading::after {
    content: ""; display: inline-block; width: 10px; height: 10px; margin-left: 6px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    vertical-align: -1px; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Custom confirm dialog (replaces native confirm()) */
  dialog#del-dialog {
    background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 16px; padding: 22px; max-width: 320px; width: calc(100% - 48px);
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  }
  dialog#del-dialog::backdrop { background: rgba(0,0,0,0.55); backdrop-filter: blur(2px); }
  dialog#del-dialog h2 { margin: 0 0 6px; font-size: 1.05rem; }
  dialog#del-dialog p { color: var(--text-dim); margin: 0 0 20px; font-size: 0.88rem; }
  .dialog-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .dialog-actions button {
    border: none; border-radius: 10px; padding: 11px 18px; font-weight: 700; font-size: 0.9rem; cursor: pointer;
  }
  .btn-cancel { background: var(--surface-2); color: var(--text); }
  .btn-confirm { background: var(--red); color: #2a0a0e; }

  /* Song detail */
  .song-badges { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
  .badge { display: inline-flex; align-items: center; gap: 4px; background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); font-size: 0.85rem; padding: 5px 12px; border-radius: 999px; }

  .transpose-bar { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; margin: 0 0 18px; width: fit-content; }
  .transpose-bar span { font-size: 0.85rem; color: var(--text-dim); }
  .transpose-bar #transpose-label { color: var(--text); font-weight: 700; min-width: 28px; text-align: center; }
  .transpose-btn { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); width: 34px; height: 34px; border-radius: 8px; font-size: 1.1rem; font-weight: 700; cursor: pointer; }
  .transpose-btn:active { background: var(--accent-dim); }

  .chord { cursor: pointer; }
  dialog#chord-dialog { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
  #chord-dialog-body { display: flex; justify-content: center; margin-bottom: 16px; min-width: 160px; min-height: 100px; align-items: center; color: var(--text-dim); font-size: 0.85rem; }

  .lyrics {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 20px 18px; font-size: 1.08rem; line-height: 2.3; word-break: break-word;
  }
  .lyrics div:empty::before, .lyrics div:has(> :only-child:empty)::before { content: ""; }
  .chord {
    display: inline-block; background: var(--accent-dim); color: var(--accent); font-weight: 800;
    font-size: 0.85em; padding: 1px 7px; border-radius: 6px; margin: 0 2px 2px 0; vertical-align: middle;
  }

  .source-link { display: block; margin-top: 18px; color: var(--text-dim); font-size: 0.85rem; }
  code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px; }
  .row-actions { margin-top: 20px; }

  @media (min-width: 640px) {
    h1 { font-size: 1.75rem; }
    .lyrics { font-size: 1.1rem; padding: 26px 30px; }
  }

  /* Login page */
  .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .login-box { width: 100%; max-width: 340px; text-align: center; }
  .login-box .logo { font-size: 2.6rem; margin-bottom: 4px; }
  .login-box h1 { margin: 0 0 4px; }
  .login-box .subtitle { margin-bottom: 24px; }
  .login-form { display: flex; flex-direction: column; gap: 10px; text-align: left; }
  .login-form input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    padding: 13px 14px; border-radius: 10px; font-size: 1rem; width: 100%;
  }
  .login-form input:focus { outline: none; border-color: var(--accent); }
  .login-form button {
    background: var(--accent); color: #1a0f04; border: none; font-weight: 700;
    padding: 13px; border-radius: 10px; font-size: 1rem; cursor: pointer; margin-top: 4px;
  }
  .login-error { background: var(--red-dim); color: var(--red); padding: 10px 14px; border-radius: 10px; font-size: 0.88rem; margin-bottom: 16px; }
  .login-switch { margin-top: 18px; font-size: 0.88rem; color: var(--text-dim); }
`;

/** Delete button — a self-contained POST form with a JS confirm dialog. */
function deleteForm(sourceId: number): string {
  const formId = `del-form-${sourceId}`;
  return `<form id="${formId}" method="POST" action="/api/song/${sourceId}/delete">
    <button type="button" class="btn-del" onclick="confirmDelete('${formId}')">Xoá</button>
  </form>`;
}

/** Shared delete-confirmation <dialog>, once per page — replaces native confirm(). */
const DELETE_DIALOG = `<dialog id="del-dialog">
  <h2>Xoá bài hát?</h2>
  <p>Bài này sẽ bị xoá khỏi DB, không thể hoàn tác.</p>
  <div class="dialog-actions">
    <button type="button" class="btn-cancel" onclick="document.getElementById('del-dialog').close()">Huỷ</button>
    <button type="button" class="btn-confirm" onclick="var f=document.getElementById(document.getElementById('del-dialog').dataset.formId); document.getElementById('del-dialog').close(); f.submit();">Xoá</button>
  </div>
</dialog>
<script>
  function confirmDelete(formId) {
    var dialog = document.getElementById('del-dialog');
    dialog.dataset.formId = formId;
    dialog.showModal();
  }
</script>`;

/** Shared chord-diagram <dialog>, opened by tapping a [Chord] pill in the lyrics. */
const CHORD_DIALOG = `<dialog id="chord-dialog">
  <div id="chord-dialog-body">…</div>
  <div class="dialog-actions">
    <button type="button" class="btn-cancel" onclick="document.getElementById('chord-dialog').close()">Đóng</button>
  </div>
</dialog>`;

/**
 * Client-side transpose: recomputes every [Chord] pill from its original
 * data-chord value on each +/- click (never compounds/drifts), and updates
 * the "Tông: N" label. Ported from src/lib/chords.ts transposeChord() — kept
 * intentionally tiny (just the chromatic-scale math) so we don't need a
 * client bundler; the big chord-shape data stays server-side only, fetched
 * on demand via /api/chord when a pill is tapped.
 */
const TRANSPOSE_SCRIPT = `<script>
  var transposeOffset = 0;
  var SCALE = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  var FLAT_TO_SHARP = {Db:"C#",Eb:"D#",Gb:"F#",Ab:"G#",Bb:"A#"};
  function noteIndex(n) { return SCALE.indexOf(FLAT_TO_SHARP[n] || n); }
  function transposeChordJs(chord, semi) {
    if (semi === 0) return chord;
    var m = chord.match(/^([A-G])(#|b)?([^/]*)(?:\\/([A-G])(#|b)?)?$/);
    if (!m) return chord;
    function shift(note) {
      var i = noteIndex(note);
      if (i === -1) return note;
      return SCALE[((i + semi) % 12 + 12) % 12];
    }
    var root = shift(m[1] + (m[2] || ""));
    var bass = m[4] ? shift(m[4] + (m[5] || "")) : null;
    return root + (m[3] || "") + (bass ? "/" + bass : "");
  }
  function applyTranspose(delta) {
    transposeOffset += delta;
    document.querySelectorAll(".chord").forEach(function (el) {
      el.textContent = transposeChordJs(el.dataset.chord, transposeOffset);
    });
    var label = document.getElementById("transpose-label");
    if (label) label.textContent = transposeOffset > 0 ? "+" + transposeOffset : String(transposeOffset);
  }
  function showChordDialog(chordName) {
    var dialog = document.getElementById("chord-dialog");
    var body = document.getElementById("chord-dialog-body");
    body.innerHTML = "Đang tải…";
    dialog.showModal();
    fetch("/api/chord?name=" + encodeURIComponent(chordName))
      .then(function (r) { return r.text(); })
      .then(function (svg) { body.innerHTML = svg; })
      .catch(function () { body.innerHTML = "Không tải được sơ đồ."; });
  }
</script>`;

/** Crawl-now button for a not-yet-crawled search result. */
function crawlForm(sourceId: number): string {
  return `<form method="POST" action="/api/crawl" onsubmit="var b=this.querySelector('button'); b.disabled=true; b.classList.add('loading'); b.textContent='Đang crawl…';">
    <input type="hidden" name="id" value="${sourceId}">
    <button type="submit" class="btn-crawl">Crawl</button>
  </form>`;
}

function searchForm(query = ""): string {
  return `<form class="search" action="/search" method="get">
    <input type="text" name="q" value="${escapeHtml(query)}" placeholder="Tìm bài hát..." required>
    <button type="submit">Tìm</button>
  </form>`;
}

function header(query = ""): string {
  return `<header class="topbar"><div class="inner">
    <div class="topbar-row">
      <a class="brand" href="/">🎸 <span>Hợp Âm</span> Chuẩn</a>
      <a class="logout-link" href="/api/logout">Đăng xuất</a>
    </div>
    ${searchForm(query)}
  </div></header>`;
}

export function layout(
  title: string,
  body: string,
  opts: { query?: string; hideHeader?: boolean } = {},
): string {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0e1013">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  ${opts.hideHeader ? "" : header(opts.query)}
  <main class="content"><div class="wrap">${body}</div></main>
  ${opts.hideHeader ? "" : DELETE_DIALOG}
</body>
</html>`;
}

export function renderLoginPage(error?: string): string {
  return layout(
    "Đăng nhập — Hợp Âm Chuẩn",
    `<div class="login-page"><div class="login-box">
      <div class="logo">🎸</div>
      <h1>Hợp Âm Chuẩn</h1>
      <p class="subtitle">Đăng nhập để tiếp tục</p>
      ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ""}
      <form class="login-form" method="POST" action="/api/login">
        <input type="text" name="username" placeholder="Tên đăng nhập" autocomplete="username" required autofocus>
        <input type="password" name="password" placeholder="Mật khẩu" autocomplete="current-password" required>
        <button type="submit">Đăng nhập</button>
      </form>
      <p class="login-switch">Chưa có tài khoản? <a href="/signup">Đăng ký</a></p>
    </div></div>`,
    { hideHeader: true },
  );
}

export function renderSignupPage(error?: string): string {
  return layout(
    "Đăng ký — Hợp Âm Chuẩn",
    `<div class="login-page"><div class="login-box">
      <div class="logo">🎸</div>
      <h1>Hợp Âm Chuẩn</h1>
      <p class="subtitle">Tạo tài khoản để dùng chung</p>
      ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : ""}
      <form class="login-form" method="POST" action="/api/signup">
        <input type="text" name="username" placeholder="Tên đăng nhập (tối thiểu 3 ký tự)" autocomplete="username" required autofocus minlength="3">
        <input type="password" name="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" autocomplete="new-password" required minlength="6">
        <button type="submit">Đăng ký</button>
      </form>
      <p class="login-switch">Đã có tài khoản? <a href="/login">Đăng nhập</a></p>
    </div></div>`,
    { hideHeader: true },
  );
}

export async function renderSongList(): Promise<string> {
  const { rows } = await getPool().query<{ source_id: number; title: string; artist: string | null }>(
    "SELECT source_id, title, artist FROM songs ORDER BY source_id DESC LIMIT 200",
  );

  const items = rows
    .map(
      (r) =>
        `<li><div><a class="title-link" href="/song/${r.source_id}">${escapeHtml(r.title)}</a><div class="artist">${escapeHtml(r.artist ?? "Không rõ ca sĩ")}</div></div>${deleteForm(r.source_id)}</li>`,
    )
    .join("");

  return layout(
    "Hợp Âm Chuẩn",
    `<p class="subtitle">${rows.length} bài đã lưu</p>
     <ul class="songs">${items || `<div class="empty">Chưa có bài nào — thử tìm bài hát ở ô search phía trên.</div>`}</ul>`,
  );
}

export async function renderSearchResults(query: string): Promise<string> {
  const results = await searchSongs(query);

  const ids = results.map((r) => r.id);
  const { rows: existing } = await getPool().query<{ source_id: number }>(
    "SELECT source_id FROM songs WHERE source_id = ANY($1::int[])",
    [ids],
  );
  const inDb = new Set(existing.map((r) => r.source_id));

  const items = results
    .map((r) => {
      const tag = inDb.has(r.id)
        ? `<span class="tag in-db">Đã lưu</span>`
        : `<span class="tag not-in-db">Chưa lưu</span>`;
      const link = inDb.has(r.id)
        ? `<a class="title-link" href="/song/${r.id}">${escapeHtml(r.title)}</a>`
        : `<a class="title-link" href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(r.title)}</a>`;
      return `<li><div>${link}<div class="artist">${escapeHtml(r.artist ?? "")}</div>${tag}</div>${inDb.has(r.id) ? deleteForm(r.id) : crawlForm(r.id)}</li>`;
    })
    .join("");

  const hasUncrawled = results.some((r) => !inDb.has(r.id));

  return layout(
    `Tìm: ${query}`,
    `<a class="back" href="/">&larr; Trang chủ</a>
     <p class="subtitle">${results.length} kết quả cho "${escapeHtml(query)}"</p>
     ${hasUncrawled ? `<p class="hint">💡 Bấm "Crawl" để lưu bài — có thể mất khoảng 30 giây đến vài phút.</p>` : ""}
     <ul class="songs">${items || `<div class="empty">Không tìm thấy bài nào.</div>`}</ul>`,
    { query },
  );
}

export async function renderSongDetail(sourceId: number): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT source_id, source_url, title, artist, composer, "key", capo, tempo, genre,
            lyrics_with_chords, view_count, published_date, crawled_at
     FROM songs WHERE source_id = $1`,
    [sourceId],
  );
  const song = rows[0];
  if (!song) return null;

  const lyricsHtml = (song.lyrics_with_chords as { line: string }[])
    .map((l) => `<div>${renderChordLine(l.line)}</div>`)
    .join("");

  const badges = [
    song.artist && `<span class="badge">🎤 ${escapeHtml(song.artist)}</span>`,
    song.composer && song.composer !== song.artist && `<span class="badge">✍️ ${escapeHtml(song.composer)}</span>`,
    song.key && `<span class="badge">🎼 Tone ${escapeHtml(song.key)}</span>`,
    song.capo != null && `<span class="badge">Capo ${song.capo}</span>`,
    song.tempo && `<span class="badge">${escapeHtml(song.tempo)}</span>`,
    song.genre && `<span class="badge">${escapeHtml(song.genre)}</span>`,
    song.view_count != null && `<span class="badge">👁 ${song.view_count}</span>`,
  ]
    .filter(Boolean)
    .join("");

  return layout(
    song.title,
    `<a class="back" href="/">&larr; Trang chủ</a>
     <h1>${escapeHtml(song.title)}</h1>
     <div class="song-badges">${badges}</div>
     <div class="transpose-bar">
       <span>Tông</span>
       <button type="button" class="transpose-btn" onclick="applyTranspose(-1)">−</button>
       <span id="transpose-label">0</span>
       <button type="button" class="transpose-btn" onclick="applyTranspose(1)">+</button>
     </div>
     <div class="lyrics">${lyricsHtml}</div>
     <a class="source-link" href="${escapeHtml(song.source_url)}" target="_blank">Nguồn: hopamchuan.com &rarr;</a>
     <div class="row-actions">${deleteForm(song.source_id)}</div>
     ${CHORD_DIALOG}
     ${TRANSPOSE_SCRIPT}`,
  );
}
