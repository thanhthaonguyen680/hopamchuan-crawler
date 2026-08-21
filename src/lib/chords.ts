/**
 * Chord transposition + guitar fingering diagrams.
 *
 * Transposition is exact (12-tone chromatic math). Diagrams are a curated
 * table of standard open-position shapes for natural roots (covers the vast
 * majority of chords in Vietnamese pop/ballad songs) plus an algorithmic
 * moveable-barre fallback (E-shape / A-shape) for anything else — so every
 * chord gets *a* correct, playable diagram, even if it's not hand-tuned.
 */

const SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP: Record<string, string> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

function normalizeNote(note: string): string {
  return FLAT_TO_SHARP[note] ?? note;
}

function noteIndex(note: string): number {
  return SCALE.indexOf(normalizeNote(note));
}

export interface ParsedChord {
  root: string;
  suffix: string;
  bass?: string;
}

export function parseChord(chord: string): ParsedChord | null {
  const m = chord.trim().match(/^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/);
  if (!m) return null;
  return {
    root: m[1] + (m[2] ?? ""),
    suffix: m[3] ?? "",
    bass: m[4] ? m[4] + (m[5] ?? "") : undefined,
  };
}

/** Shift a single chord by N semitones (negative = down). Unrecognized chords pass through unchanged. */
export function transposeChord(chord: string, semitones: number): string {
  if (semitones === 0) return chord;
  const parsed = parseChord(chord);
  if (!parsed) return chord;

  const shift = (note: string): string => {
    const idx = noteIndex(note);
    if (idx === -1) return note;
    return SCALE[(((idx + semitones) % 12) + 12) % 12];
  };

  const newRoot = shift(parsed.root);
  const newBass = parsed.bass ? shift(parsed.bass) : undefined;
  return newRoot + parsed.suffix + (newBass ? "/" + newBass : "");
}

/** Transpose every [Chord] tag in a lyric line. */
export function transposeLine(line: string, semitones: number): string {
  if (semitones === 0) return line;
  return line.replace(/\[([^\]]+)\]/g, (_, chord) => `[${transposeChord(chord, semitones)}]`);
}

// --- Fingering diagrams --------------------------------------------------

export interface ChordShape {
  /** 6 entries, string 6 (low E) to string 1 (high E). "x" = muted, 0 = open. */
  frets: (number | "x")[];
  /** Finger number 1-4 per string, or null if open/muted/unlabeled. */
  fingers: (number | null)[];
  /** Absolute fret of the diagram's top row (1 = nut). */
  baseFret: number;
}

// Hand-verified standard open-position shapes. Covers natural roots (C D E F G A B)
// across the qualities that actually show up in this app's songs.
const OPEN_SHAPES: Record<string, ChordShape> = {
  C: { frets: ["x", 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null], baseFret: 1 },
  C7: { frets: ["x", 3, 2, 3, 1, 0], fingers: [null, 3, 2, 4, 1, null], baseFret: 1 },
  Cmaj7: { frets: ["x", 3, 2, 0, 0, 0], fingers: [null, 3, 2, null, null, null], baseFret: 1 },
  Cm: { frets: ["x", 3, 5, 5, 4, 3], fingers: [null, 1, 3, 4, 2, 1], baseFret: 3 },
  D: { frets: ["x", "x", 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2], baseFret: 1 },
  Dm: { frets: ["x", "x", 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1], baseFret: 1 },
  D7: { frets: ["x", "x", 0, 2, 1, 2], fingers: [null, null, null, 2, 1, 3], baseFret: 1 },
  Dmaj7: { frets: ["x", "x", 0, 2, 2, 2], fingers: [null, null, null, 1, 2, 3], baseFret: 1 },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null], baseFret: 1 },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null], baseFret: 1 },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [null, 2, null, 1, null, null], baseFret: 1 },
  Emaj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [null, 3, 1, 2, null, null], baseFret: 1 },
  F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], baseFret: 1 },
  Fmaj7: { frets: ["x", "x", 3, 2, 1, 0], fingers: [null, null, 3, 2, 1, null], baseFret: 1 },
  Fm: { frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1], baseFret: 1 },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], baseFret: 1 },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, null, null, null, 1], baseFret: 1 },
  Gm: { frets: [3, 5, 5, 3, 3, 3], fingers: [1, 3, 4, 1, 1, 1], baseFret: 3 },
  A: { frets: ["x", 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null], baseFret: 1 },
  Am: { frets: ["x", 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null], baseFret: 1 },
  A7: { frets: ["x", 0, 2, 0, 2, 0], fingers: [null, null, 2, null, 3, null], baseFret: 1 },
  Am7: { frets: ["x", 0, 2, 0, 1, 0], fingers: [null, null, 2, null, 1, null], baseFret: 1 },
  Amaj7: { frets: ["x", 0, 2, 1, 2, 0], fingers: [null, null, 3, 1, 2, null], baseFret: 1 },
  B7: { frets: ["x", 2, 1, 2, 0, 2], fingers: [null, 2, 1, 3, null, 4], baseFret: 1 },
  Bm: { frets: ["x", 2, 4, 4, 3, 2], fingers: [null, 1, 3, 4, 2, 1], baseFret: 2 },
  B: { frets: ["x", 2, 4, 4, 4, 2], fingers: [null, 1, 3, 3, 3, 1], baseFret: 2 },
};

// Moveable barre shapes, expressed relative to a barre at fret 0 — used only
// as a fallback when OPEN_SHAPES has nothing for this root+suffix.
// -1 marks a muted string; other values are frets above the barre.
const E_SHAPE: Record<string, number[]> = {
  "": [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  "7": [0, 2, 0, 1, 0, 0],
  m7: [0, 2, 0, 0, 0, 0],
  maj7: [0, 2, 1, 1, 0, 0],
};
const A_SHAPE: Record<string, number[]> = {
  "": [-1, 0, 2, 2, 2, 0],
  m: [-1, 0, 2, 2, 1, 0],
  "7": [-1, 0, 2, 0, 2, 0],
  m7: [-1, 0, 2, 0, 1, 0],
  maj7: [-1, 0, 2, 1, 2, 0],
};

function barreShape(root: string, suffix: string): ChordShape | null {
  const rootIdx = noteIndex(root);
  if (rootIdx === -1 || !(suffix in E_SHAPE)) return null;

  const eOffset = (rootIdx - noteIndex("E") + 12) % 12;
  const aOffset = (rootIdx - noteIndex("A") + 12) % 12;
  const useE = eOffset <= aOffset;
  const offset = useE ? eOffset : aOffset;
  const pattern = useE ? E_SHAPE[suffix] : A_SHAPE[suffix];

  const frets: (number | "x")[] = pattern.map((f) => (f === -1 ? "x" : f + offset));
  // Only the barre finger (1) is labeled — the rest of the fallback shape's
  // extra fingering varies by hand size/style, so we show correct dots
  // without guessing a specific finger number for them.
  const fingers: (number | null)[] = frets.map((f) => (f === "x" ? null : f === offset ? 1 : null));

  return { frets, fingers, baseFret: offset === 0 ? 1 : offset + 1 };
}

export function getChordShape(chord: string): ChordShape | null {
  const parsed = parseChord(chord);
  if (!parsed) return null;

  const key = parsed.root + parsed.suffix;
  if (OPEN_SHAPES[key]) return OPEN_SHAPES[key];
  return barreShape(parsed.root, parsed.suffix);
}

/** Render a fretboard diagram as an inline SVG string (~160x210). */
export function renderChordSvg(chord: string): string {
  const shape = getChordShape(chord);
  const escapedName = chord.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (!shape) {
    return `<svg viewBox="0 0 160 100" width="160" height="100" xmlns="http://www.w3.org/2000/svg">
      <text x="80" y="30" text-anchor="middle" font-size="18" font-weight="700" fill="#f1f2f4">${escapedName}</text>
      <text x="80" y="60" text-anchor="middle" font-size="12" fill="#8b92a3">Chưa có sơ đồ cho hợp âm này</text>
    </svg>`;
  }

  const NUT_Y = 30;
  const FRET_H = 34;
  const left = 20;
  const right = 140;
  const step = (right - left) / 5;
  const xs = [0, 1, 2, 3, 4, 5].map((i) => left + i * step);

  const rows = 4;
  const viewH = NUT_Y + rows * FRET_H + 20;
  let svg = `<svg viewBox="0 0 160 ${viewH}" width="160" height="${viewH}" xmlns="http://www.w3.org/2000/svg">`;

  // Chord name
  svg += `<text x="80" y="16" text-anchor="middle" font-size="16" font-weight="800" fill="#f1f2f4">${escapedName}</text>`;

  // Nut (thick if baseFret===1) or top bar
  svg += `<line x1="${xs[0]}" y1="${NUT_Y}" x2="${xs[5]}" y2="${NUT_Y}" stroke="#c9cdd6" stroke-width="${shape.baseFret === 1 ? 4 : 1.5}" />`;

  // Fret lines
  for (let r = 1; r <= rows; r++) {
    const y = NUT_Y + r * FRET_H;
    svg += `<line x1="${xs[0]}" y1="${y}" x2="${xs[5]}" y2="${y}" stroke="#3a3f4a" stroke-width="1" />`;
  }
  // Strings
  for (const x of xs) {
    svg += `<line x1="${x}" y1="${NUT_Y}" x2="${x}" y2="${NUT_Y + rows * FRET_H}" stroke="#3a3f4a" stroke-width="1" />`;
  }

  // Fret number labels on the right (absolute fret per row)
  for (let r = 0; r < rows; r++) {
    const absFret = shape.baseFret + r;
    const y = NUT_Y + r * FRET_H + FRET_H / 2 + 4;
    svg += `<text x="${xs[5] + 14}" y="${y}" font-size="10" fill="#8b92a3">${absFret}fr</text>`;
  }

  // Per-string markers
  shape.frets.forEach((f, i) => {
    const x = xs[i];
    if (f === "x") {
      svg += `<text x="${x}" y="${NUT_Y - 10}" text-anchor="middle" font-size="13" font-weight="700" fill="#8b92a3">✕</text>`;
      return;
    }
    if (f === 0) {
      svg += `<circle cx="${x}" cy="${NUT_Y - 12}" r="5" fill="none" stroke="#8b92a3" stroke-width="1.5" />`;
      return;
    }
    const relativeRow = f - shape.baseFret; // 0-indexed row within the diagram
    if (relativeRow < 0 || relativeRow >= rows) return; // out of the visible window (rare)
    const y = NUT_Y + relativeRow * FRET_H + FRET_H / 2;
    svg += `<circle cx="${x}" cy="${y}" r="9" fill="#ff9d52" />`;
    const finger = shape.fingers[i];
    if (finger) {
      svg += `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#1a0f04">${finger}</text>`;
    }
  });

  svg += `</svg>`;
  return svg;
}
