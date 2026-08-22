# HopAmChuan Crawler

hopamchuan.com hay chèn quảng cáo video khi xem hợp âm, gây khó chịu. Tool này crawl **những bài mình chọn** (không crawl hàng loạt), parse ra lời + hợp âm sạch bằng Gemini, lưu Postgres, xem lại qua web viewer riêng — không quảng cáo, đổi tông được, tap hợp âm ra sơ đồ ngón bấm guitar. Xem `n8n/README.md` nếu muốn chạy tự động qua cron.

**Production**: https://hopamchuan-crawler.vercel.app — ai có link cũng vào được, tự `/signup` tạo tài khoản riêng (không dùng chung 1 mật khẩu).

## Ghi chú quan trọng về hopamchuan.com

- Không có `sitemap.xml` — robots.txt chỉ có policy AI content-signal, không có `Sitemap:` directive.
- URL bài hát: `https://hopamchuan.com/song/{id}/{slug}/` — server chỉ quan tâm `{id}`, slug sai vẫn ra đúng trang. Vì vậy discovery **dò theo dải ID tăng dần** (lưu `MAX(source_id)` trong DB, probe tiếp từ đó) thay vì crawl sitemap.
- Slug thật để lưu `source_url` không nằm ở `<link rel="canonical">`/`og:url` (chỉ echo lại slug đã request) — phải lấy từ JSON-LD, xem `src/lib/discover.ts`.
- Trang bài hát có vùng nội dung hữu ích nằm giữa `id="song-info"` và comment `<!-- song detail info -->` — `extractRelevantSection()` cắt HTML về đúng vùng này trước khi gửi LLM, giảm ~55% dung lượng (nav/quảng cáo/"bài khác" không cần).

## Cài đặt

```bash
npm install
cp .env.example .env
# điền GEMINI_API_KEY (free tại aistudio.google.com/apikey) + DATABASE_URL vào .env
npm run migrate
# vào https://hopamchuan-crawler.vercel.app/signup tạo tài khoản, rồi điền
# username đó vào CRAWL_USERNAME trong .env — script local dùng để biết ghi
# bài crawl được vào tài khoản nào
```

## Các lệnh chính

| Lệnh | Mô tả |
|---|---|
| `npm run search -- "tên bài"` | Tìm bài trên hopamchuan.com (không quảng cáo), lấy ID để crawl |
| `npm run crawl -- --ids 123,456` | Crawl đúng ID đã chọn |
| `npm run crawl` | Crawl tự động: dò tiếp từ `MAX(source_id)` trong DB |
| `npm run crawl -- --discover-only` | Chỉ discovery + fetch, không gọi LLM, không ghi DB — miễn phí 100% |
| `npm run crawl -- --dry-run` | Gọi LLM thật nhưng không ghi DB — test chất lượng parse |
| `npm run viewer` | Web viewer local tại http://localhost:3000 |
| `npm run migrate` | Tạo bảng `users` + `songs` + `crawl_log` |

## Cấu trúc

```
src/lib/
  http.ts        fetchHtml() — timeout + retry, không retry trên 404
  discover.ts    discoverNewSongs() / fetchSongsByIds() — dò ID, trích slug thật
  search.ts      searchSongs() — dùng /search có sẵn của hopamchuan.com
  validate.ts    SYSTEM_PROMPT, extractRelevantSection(), sanitizeHtml(), validate()
  gemini.ts      parseSongHtml() — gọi Gemini (@google/genai), timeout 90s + retry
  parser.ts      parseSong() — dispatcher theo LLM_PROVIDER (claude/gemini)
  chords.ts      transposeChord(), getChordShape() — nhạc lý + sơ đồ ngón bấm
  render.ts      HTML render dùng chung cho viewer.ts (local) và api/*.ts (Vercel)
  auth.ts        Tài khoản đa người dùng: hash mật khẩu (scrypt), sign session cookie
  db.ts          pg Pool, upsertSong(), insertCrawlLog()
src/crawl.ts     script tổng — production entrypoint
src/viewer.ts    web server local (npm run viewer)
api/*.ts         Vercel serverless functions (bản public, cùng logic render.ts)
sql/schema.sql   DDL bảng users, songs (per-user), crawl_log
```

## Deploy (Vercel)

- `api/*.ts` dùng chung `src/lib/render.ts` với `src/viewer.ts` — chỉ khác lớp server (Vercel function vs Node http server liên tục). Script crawl/parse **không** chạy trên Vercel, chỉ chạy local; Vercel chỉ đọc/ghi DB qua web UI (crawl button, xoá bài).
- `DATABASE_URL` trỏ thẳng Neon — cùng 1 DB cho local và Vercel, crawl xong thấy ngay trên web.
- Login: đa người dùng, tự `/signup` tạo tài khoản (username + mật khẩu hash bằng scrypt, lưu bảng `users`). Session là cookie `hac_session` ký bằng `SESSION_SECRET` (HMAC, chứa user id + chữ ký — không phải mật khẩu). **Dữ liệu tách riêng theo tài khoản**: `songs.user_id` + unique index theo `(user_id, source_id)` — mỗi người có danh sách bài hát của riêng mình, crawl trùng ID hopamchuan.com vẫn ra 2 bản ghi riêng cho 2 tài khoản. `requireAuth()` gate mọi route, `noindex` để Google không index.
- ⚠️ `vercel dev` trên máy này đọc biến từ `.env` (không phải `.env.local`) — thêm biến mới cho Vercel thì set cả 2 nơi để test local được.
- Deploy lại: `npx vercel deploy --prod`

## Đổi tông + sơ đồ hợp âm

`src/lib/chords.ts`: transpose chính xác (12 nốt chromatic, xử lý cả slash chord `D/F#`) + bảng sơ đồ mở chuẩn cho C/D/E/F/G/A/B (+m/7/maj7) và fallback tự sinh thế bấm chặn dây cho hợp âm khác. Trang bài hát có nút **Tông [−]/[+]** (client-side, không reload) và tap hợp âm mở sơ đồ SVG qua `/api/chord`.

Đã lược bớt: không phát âm thanh, không có nhiều "thế tay" khác nhau cho 1 hợp âm (chỉ 1 sơ đồ chuẩn). Đổi tông không lưu qua session.

## Giới hạn đã biết

- `discoverNewSongs` tốn 1 request HTML/ID kể cả khi 404, nhưng bù lại dùng luôn HTML đó để parse (không fetch 2 lần).
- Site đổi cấu trúc URL/HTML thì cần cập nhật `extractRealSongUrl()` và `extractRelevantSection()`.
- `published_date` lấy theo ngày "Cập nhật" (không có ngày "đăng" riêng).
- `n8n/README.md` hiện chỉ wiring cho Claude REST API, chưa có bản Gemini.
