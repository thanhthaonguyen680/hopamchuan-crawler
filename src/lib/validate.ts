import type { LyricLine, ParsedSong } from "./types.js";

export const SYSTEM_PROMPT = `Bạn là công cụ trích xuất dữ liệu. Nhiệm vụ: đọc HTML thô của một trang bài hát trên hopamchuan.com và trả về DUY NHẤT một object JSON hợp lệ theo đúng schema bên dưới — không thêm markdown fence, không giải thích, không có văn bản nào khác ngoài JSON.

Schema:
{
  "source_url": string,            // URL trang đã cho
  "title": string,                 // tên bài hát (bắt buộc, không được rỗng)
  "artist": string | null,         // ca sĩ trình bày; nếu nhiều người, nối bằng ", "; null nếu không có
  "composer": string | null,       // người sáng tác; null nếu trang không ghi rõ
  "key": string | null,            // tông/hợp âm chủ đạo (vd "D", "Am"); thường ở data-key hoặc badge tông
  "capo": number | null,           // số ngăn capo nếu có ghi rõ; null nếu không đề cập
  "tempo": string | null,          // điệu/nhịp bài hát (vd "Slow", "Ballad"); null nếu không có ("chọn điệu" nghĩa là chưa có = null)
  "genre": string | null,          // thể loại nếu trang có ghi; null nếu không có
  "lyrics_with_chords": [{"line": string}],  // MỖI phần tử là một dòng lời bài hát, giữ NGUYÊN hợp âm chèn trong dòng ở dạng [C], [Am], [E7]... đúng vị trí xuất hiện trong div.chord_lyric_line. Dòng trống vẫn giữ lại (line: "").
  "chords_used": string[],         // danh sách các hợp âm duy nhất xuất hiện trong bài (vd ["D","E7","G","B7"]), không trùng lặp, giữ thứ tự xuất hiện lần đầu
  "view_count": number | null,     // số lượt xem, từ nhãn "Lượt xem"; null nếu không thấy
  "published_date": string | null, // định dạng YYYY-MM-DD. Nếu trang chỉ có ngày "cập nhật" (vd "ngày 8 tháng 08, 2026") thì dùng ngày đó; null nếu không tìm thấy ngày nào
  "crawled_at": string             // để trống bằng chuỗi rỗng "" — hệ thống sẽ tự điền lại giá trị này
}

Quy tắc quan trọng:
- lyrics_with_chords: tái tạo từ cấu trúc <div class="chord_lyric_line">...<span class="hopamchuan_lyric">...</span>...<span class="hopamchuan_chord_inline"><i>[</i><span class="hopamchuan_chord">X</span><i>]</i></span>... — ghép lại thành một chuỗi text theo đúng thứ tự xuất hiện, hợp âm luôn ở dạng "[X]".
- Bỏ qua hoàn toàn quảng cáo, script, nav, footer, bình luận, các phần không liên quan tới nội dung bài hát.
- title không được null hoặc rỗng — nếu không tìm thấy tiêu đề rõ ràng, dùng nội dung thẻ <h1> hoặc <title>.
- Chỉ trả JSON thuần, bắt đầu bằng { và kết thúc bằng }.`;

/**
 * The song page's useful content (title/artist/key/lyrics+chords/genre/
 * composer/view count) all sits between the `id="song-info"` div and the
 * `<!-- song detail info -->` comment right after the stats table — verified
 * against real pages (both with and without capo). Everything outside that
 * window is nav/header, ~15KB of ad slots, or the "related songs" sidebar
 * (which alone can be 40KB+) — none of it is ever needed for parsing.
 * Falls back to the full HTML unchanged if either marker is missing (e.g.
 * the site's markup changes), so parsing degrades gracefully rather than
 * silently losing data.
 */
export function extractRelevantSection(html: string): string {
  const start = html.indexOf('id="song-info"');
  if (start === -1) return html;

  const endMarker = "<!-- song detail info -->";
  const endMarkerIdx = html.indexOf(endMarker, start);
  const end = endMarkerIdx === -1 ? html.length : endMarkerIdx + endMarker.length;

  return html.slice(start, end);
}

export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<ins\b[^>]*>[\s\S]*?<\/ins>/gi, "") // adsbygoogle slots
    .replace(/<!--[\s\S]*?-->/g, "");
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export class ValidationError extends Error {}

/**
 * Shared validation for both LLM providers — every provider implementation
 * must funnel its raw parsed JSON through this before returning a
 * ParsedSong, so Claude and Gemini output are held to the identical bar.
 */
export function validate(raw: unknown, sourceUrl: string): ParsedSong {
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError("Response is not a JSON object");
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.title !== "string" || o.title.trim() === "") {
    throw new ValidationError("title is missing or empty");
  }

  if (!Array.isArray(o.lyrics_with_chords)) {
    throw new ValidationError("lyrics_with_chords must be an array");
  }
  const lyrics: LyricLine[] = o.lyrics_with_chords.map((entry, i) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as any).line !== "string") {
      throw new ValidationError(`lyrics_with_chords[${i}] must be {"line": string}`);
    }
    return { line: (entry as any).line };
  });

  if (!Array.isArray(o.chords_used) || o.chords_used.some((c) => typeof c !== "string")) {
    throw new ValidationError("chords_used must be a string array");
  }

  const nullableString = (v: unknown, field: string): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") throw new ValidationError(`${field} must be string or null`);
    return v.trim() === "" ? null : v;
  };

  const nullableNumber = (v: unknown, field: string): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new ValidationError(`${field} must be number or null`);
    }
    return v;
  };

  let publishedDate = nullableString(o.published_date, "published_date");
  if (publishedDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) {
    // Model failed to normalize the date — drop it rather than store garbage.
    publishedDate = null;
  }

  return {
    source_url: sourceUrl,
    title: o.title,
    artist: nullableString(o.artist, "artist"),
    composer: nullableString(o.composer, "composer"),
    key: nullableString(o.key, "key"),
    capo: nullableNumber(o.capo, "capo"),
    tempo: nullableString(o.tempo, "tempo"),
    genre: nullableString(o.genre, "genre"),
    lyrics_with_chords: lyrics,
    chords_used: o.chords_used as string[],
    view_count: nullableNumber(o.view_count, "view_count"),
    published_date: publishedDate,
    crawled_at: new Date().toISOString(),
  };
}
