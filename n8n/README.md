# Đóng gói sang n8n

Sơ đồ workflow map 1:1 với logic đã test trong `src/crawl.ts`, chia thành các node n8n chuẩn: **Schedule Trigger → Postgres → Code → Split In Batches → HTTP Request → IF → Code → HTTP Request (Claude) → Code → IF → Postgres**.

Import ý tưởng theo đúng thứ tự node bên dưới (tạo thủ công trong n8n UI — mỗi node kèm cấu hình cụ thể). Nếu muốn, sau khi bạn xác nhận đã cài n8n và version, tôi có thể xuất trực tiếp file `workflow.json` để import một phát ăn ngay; nhưng cấu hình tay theo hướng dẫn này sẽ chắc ăn hơn vì schema JSON của n8n phụ thuộc version.

---

## 0. Credentials cần tạo trước trong n8n

| Credential | Loại | Dùng ở |
|---|---|---|
| `Postgres - HopAmChuan` | Postgres | tất cả node Postgres |
| `Anthropic API Key` | Header Auth (`x-api-key: <key>`) | node HTTP Request gọi Claude |

---

## 1. Schedule Trigger

- Cron: `0 3 * * *` (3h sáng hàng ngày, sau giờ ít traffic).

## 2. Postgres — "Get max known ID"

Execute Query:

```sql
SELECT COALESCE(MAX(source_id), 0) AS max_id FROM songs;
```

Output: 1 item `{ max_id: number }`.

## 3. Code — "Build probe ID list"

```javascript
const BATCH_SIZE = Number($env.CRAWL_ID_BATCH_SIZE || 200);
const startId = $input.first().json.max_id + 1;

const items = [];
for (let i = 0; i < BATCH_SIZE; i++) {
  items.push({ json: { id: startId + i, probeUrl: `https://hopamchuan.com/song/${startId + i}/x/` } });
}
return items;
```

> `BATCH_SIZE` nhỏ (100–200) là đủ cho crawl hàng ngày — không cần logic "dừng sau N miss liên tiếp" như bản Node.js CLI, vì batch cố định + chạy hàng ngày khiến vài request 404 dư không đáng kể.

## 4. Split In Batches — batch size = 1

Để loop tuần tự từng ID (tránh spam site cùng lúc). Nối output "loop" sang bước 5, output "done" sang cuối workflow (kết thúc run).

## 5. HTTP Request — "Fetch song page"

- Method: `GET`
- URL: `={{ $json.probeUrl }}`
- Options → **Continue On Fail**: bật (để 404 không làm chết workflow)
- Options → Response → Full Response: bật (cần cả `statusCode` lẫn `body`)
- Timeout: 15000 ms

## 6. IF — "Page exists?"

Condition: `{{ $json.statusCode }}` equals `200`

- **True** → bước 7
- **False** → quay lại Split In Batches (item này coi như "miss", không log — hoặc nối vào một nhánh Postgres phụ nếu bạn muốn log cả miss).

## 7. Code — "Extract real URL + sanitize HTML"

```javascript
const id = $('Build probe ID list').item.json.id;
const html = $json.body;

function extractRealUrl(html, id) {
  const re = new RegExp(`https?://hopamchuan\\.com/song/${id}/([a-z0-9-]+)`, "gi");
  for (const m of html.matchAll(re)) {
    if (m[1] !== "x") return `https://hopamchuan.com/song/${id}/${m[1]}/`;
  }
  return null;
}

const cleanedHtml = html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
  .replace(/<!--[\s\S]*?-->/g, "");

return [{
  json: {
    id,
    url: extractRealUrl(html, id) || `https://hopamchuan.com/song/${id}/x/`,
    html: cleanedHtml,
  },
}];
```

## 8. Postgres — "Already in DB?"

```sql
SELECT 1 FROM songs WHERE source_id = {{ $json.id }} LIMIT 1;
```

Nối một **IF** node: nếu có row → skip (quay lại loop, không cần log — về lý thuyết không nên xảy ra vì ta bắt đầu từ `max_id+1`, node này chỉ để an toàn). Nếu không có row → bước 9.

## 9. HTTP Request — "Parse via Claude"

- Method: `POST`
- URL: `https://api.anthropic.com/v1/messages`
- Authentication: Generic Credential Type → Header Auth → chọn credential `Anthropic API Key`
- Headers:
  - `anthropic-version: 2023-06-01`
  - `content-type: application/json`
- Body (JSON, mode "Expression"):

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16000,
  "system": "={{ $('Extract real URL + sanitize HTML').item.json.systemPrompt }}",
  "messages": [
    {
      "role": "user",
      "content": "={{ 'source_url: ' + $json.url + '\n\nHTML:\n' + $json.html }}"
    }
  ]
}
```

> Gợi ý: đưa toàn bộ `SYSTEM_PROMPT` từ `src/lib/claude.ts` vào một node **Set** riêng (hoặc biến môi trường n8n) rồi tham chiếu, để không phải nhồi chuỗi dài vào từng node — tránh lặp code khi cần chỉnh prompt.

## 10. Code — "Validate & build song object"

Port lại `validate()` trong `src/lib/claude.ts` sang JS thuần (không import được TS trong Code node), input là `$json.body.content[0].text`:

```javascript
const url = $('Extract real URL + sanitize HTML').item.json.url;
const id = $('Extract real URL + sanitize HTML').item.json.id;
const raw = $json.body.content.find(b => b.type === 'text').text;

function extractJson(text) {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found');
  return JSON.parse(t.slice(start, end + 1));
}

function nullableString(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new Error('expected string or null');
  return v.trim() === '' ? null : v;
}
function nullableNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error('expected number or null');
  return v;
}

try {
  const o = extractJson(raw);
  if (typeof o.title !== 'string' || o.title.trim() === '') throw new Error('title missing/empty');
  if (!Array.isArray(o.lyrics_with_chords)) throw new Error('lyrics_with_chords must be array');
  if (!Array.isArray(o.chords_used) || o.chords_used.some(c => typeof c !== 'string')) {
    throw new Error('chords_used must be string[]');
  }
  let publishedDate = nullableString(o.published_date);
  if (publishedDate && !/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) publishedDate = null;

  return [{
    json: {
      ok: true,
      source_id: id,
      song: {
        source_url: url,
        title: o.title,
        artist: nullableString(o.artist),
        composer: nullableString(o.composer),
        key: nullableString(o.key),
        capo: nullableNumber(o.capo),
        tempo: nullableString(o.tempo),
        genre: nullableString(o.genre),
        lyrics_with_chords: o.lyrics_with_chords,
        chords_used: o.chords_used,
        view_count: nullableNumber(o.view_count),
        published_date: publishedDate,
        crawled_at: new Date().toISOString(),
      },
    },
  }];
} catch (err) {
  return [{ json: { ok: false, source_id: id, source_url: url, error: String(err) } }];
}
```

## 11. IF — "Parsed OK?"

Condition: `{{ $json.ok }}` equals `true`

### True → Postgres "Upsert song"

```sql
INSERT INTO songs (
  source_id, source_url, title, artist, composer, "key", capo, tempo,
  genre, lyrics_with_chords, chords_used, view_count, published_date, crawled_at
) VALUES (
  {{ $json.source_id }}, '{{ $json.song.source_url }}', {{ JSON.stringify($json.song.title) }},
  {{ $json.song.artist ? JSON.stringify($json.song.artist) : 'NULL' }},
  {{ $json.song.composer ? JSON.stringify($json.song.composer) : 'NULL' }},
  {{ $json.song.key ? JSON.stringify($json.song.key) : 'NULL' }},
  {{ $json.song.capo ?? 'NULL' }},
  {{ $json.song.tempo ? JSON.stringify($json.song.tempo) : 'NULL' }},
  {{ $json.song.genre ? JSON.stringify($json.song.genre) : 'NULL' }},
  '{{ JSON.stringify($json.song.lyrics_with_chords).replace(/'/g, "''") }}'::jsonb,
  ARRAY[{{ $json.song.chords_used.map(c => `'${c.replace(/'/g, "''")}'`).join(',') }}]::text[],
  {{ $json.song.view_count ?? 'NULL' }},
  {{ $json.song.published_date ? `'${$json.song.published_date}'` : 'NULL' }},
  '{{ $json.song.crawled_at }}'
)
ON CONFLICT (source_id) DO UPDATE SET
  source_url = EXCLUDED.source_url, title = EXCLUDED.title, artist = EXCLUDED.artist,
  composer = EXCLUDED.composer, "key" = EXCLUDED."key", capo = EXCLUDED.capo,
  tempo = EXCLUDED.tempo, genre = EXCLUDED.genre,
  lyrics_with_chords = EXCLUDED.lyrics_with_chords, chords_used = EXCLUDED.chords_used,
  view_count = EXCLUDED.view_count, published_date = EXCLUDED.published_date,
  crawled_at = EXCLUDED.crawled_at;
```

> **Lưu ý an toàn**: cách build SQL bằng string interpolation trực tiếp trong expression n8n như trên **chỉ an toàn vì dữ liệu đến từ Claude (đã qua validate)**, không phải input người dùng trực tiếp — nhưng vẫn có rủi ro injection nếu title/lyrics chứa dấu `'` chưa escape hết. **Khuyến nghị thay bằng n8n Postgres node ở chế độ "Insert" / "Upsert" (dùng Fields UI, không viết raw SQL)** — n8n tự parameterize query, an toàn hơn nhiều so với raw SQL query node. Bản raw SQL ở trên chỉ để tham khảo cấu trúc.

Sau đó nối Postgres **"Log crawl_log"**:

```sql
INSERT INTO crawl_log (run_id, source_id, source_url, status, started_at, finished_at, duration_ms)
VALUES ('{{ $workflow.id }}-{{ $execution.id }}', {{ $json.source_id }}, '{{ $json.song.source_url }}', 'upserted', now(), now(), 0);
```

### False → Postgres "Log parse_failed"

```sql
INSERT INTO crawl_log (run_id, source_id, source_url, status, error_message, started_at, finished_at)
VALUES ('{{ $workflow.id }}-{{ $execution.id }}', {{ $json.source_id }}, '{{ $json.source_url }}', 'parse_failed', {{ JSON.stringify($json.error) }}, now(), now());
```

## 12. Wait node — delay trước khi loop lại

- Wait: `1.5` seconds (khớp `CRAWL_DELAY_MS` mặc định) — đặt giữa bước cuối và quay lại **Split In Batches** để tôn trọng rate-limit, tránh bị site chặn IP.

Nối output của Wait ngược về input "loop" của **Split In Batches** (bước 4) để xử lý item tiếp theo.

---

## Ghi chú vận hành

- **Idempotent theo `source_id`**: chạy lại workflow nhiều lần không tạo trùng dữ liệu nhờ `ON CONFLICT (source_id)`.
- **Batch size / lịch chạy**: bắt đầu với `BATCH_SIZE=100–200` chạy 1 lần/ngày; nếu tốc độ ra bài mới cao, có thể tăng tần suất (vd mỗi 6 tiếng) và giảm batch size tương ứng.
- **Retry ở tầng HTTP Request node**: bật "Retry On Fail" (n8n có sẵn) cho cả node fetch trang lẫn node gọi Claude, số lần retry 2–3, để thay thế phần retry/backoff thủ công trong `fetchHtml()` của bản Node.js.
- **Giám sát lỗi**: thêm một nhánh "Error Trigger" workflow riêng (n8n hỗ trợ) để nhận thông báo (Slack/Email) khi execution fail, dựa trên các dòng `crawl_log.status = 'parse_failed'` tích lũy quá ngưỡng.
- **Bảo mật API key**: luôn dùng n8n Credentials (không hardcode `x-api-key` / `DATABASE_URL` trực tiếp trong node).
