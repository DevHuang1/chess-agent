const PIECE_MAP: Record<string, Record<string, string>> = {
  en: { pawn: "", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" },
  es: { peón: "", caballo: "N", alfil: "B", torre: "R", dama: "Q", rey: "K" },
  fr: { pion: "", cavalier: "N", fou: "B", tour: "R", dame: "Q", roi: "K" },
  de: { bauer: "", springer: "N", läufer: "B", turm: "R", dame: "Q", könig: "K" },
  it: { pedone: "", cavallo: "N", alfiere: "B", torre: "R", regina: "Q", re: "K" },
  pt: { peão: "", cavalo: "N", bispo: "B", torre: "R", rainha: "Q", rei: "K" },
};

const FILLER_WORDS = ["to", "on", "at", "the", "a", "an", "square", "en", "à", "al", "el", "la", "le", "der", "die", "das", "il", "lo", "um", "uma", "o", "os", "as"];

function normalizeText(text: string): string {
  let normalized = text.toLowerCase().trim();
  normalized = normalized.replace(/[^a-zà-ÿœæéèêëîïôöùûüçñáéíóúäöüß0-9\s-]/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function extractSquare(text: string): string | null {
  const matches = text.match(/[a-h][1-8]/g);
  return matches ? matches[matches.length - 1] : null;
}

function detectCastle(text: string): string | null {
  const castlePatterns = [
    /o-o-o|queen[’']?s\s*side\s*castle|long\s*castle|grand[’']?s\s*roqu?/i,
    /o-o|king[’']?s\s*side\s*castle|short\s*castle|petit\s*roqu?|small\s*castle/i,
  ];
  if (castlePatterns[0].test(text)) return "O-O-O";
  if (castlePatterns[1].test(text)) return "O-O";
  return null;
}

function detectTakes(text: string, lang: string): boolean {
  const takeWords: Record<string, string[]> = {
    en: ["takes", "captures", "takes on", "captures on", "x"],
    es: ["toma", "captura", "come"],
    fr: ["prend", "capture", "prends"],
    de: ["nimmt", "schlägt", "erobert"],
    it: ["prende", "cattura", "mangia"],
    pt: ["toma", "captura", "come"],
  };
  const words = takeWords[lang] ?? takeWords.en;
  return words.some((w) => text.includes(w));
}

const PIECE_ABBREVIATIONS: Record<string, string> = {
  p: "",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K",
};

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function extractPiece(text: string, lang: string): string | null {
  const map = PIECE_MAP[lang] ?? PIECE_MAP.en;

  for (const [name, letter] of Object.entries(map)) {
    if (name && new RegExp(`\\b${name}\\b`, "i").test(text)) return letter;
  }

  for (const word of text.split(/\s+/)) {
    if (word in PIECE_ABBREVIATIONS) return PIECE_ABBREVIATIONS[word];
  }

  let best: { dist: number; letter: string } | null = null;
  for (const word of text.split(/\s+/)) {
    for (const [name, letter] of Object.entries(map)) {
      if (!name) continue;
      const dist = levenshtein(word.toLowerCase(), name.toLowerCase());
      const threshold = Math.max(1, Math.round(name.length / 3));
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { dist, letter };
      }
    }
  }
  return best ? best.letter : null;
}

function extractSanPiece(text: string, square: string): string | null {
  const idx = text.lastIndexOf(square);
  const prefix = text.slice(0, idx).trim();
  if (!prefix) return null;

  const match = prefix.match(/^([pbnrqk])([a-h]|[1-8])?$/);
  if (!match) return null;

  const pieceLetter = PIECE_ABBREVIATIONS[match[1]];
  return `${pieceLetter}${match[2] ?? ""}`;
}

export function parseChessMove(text: string, lang: string = "en"): string | null {
  const castle = detectCastle(text);
  if (castle) return castle;

  let normalized = normalizeText(text);

  const uciMatch = normalized.match(/^([a-h][1-8])([a-h][1-8])$/);
  if (uciMatch) return `${uciMatch[1]}${uciMatch[2]}`;

  const takes = detectTakes(normalized, lang);

  for (const word of FILLER_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, "g"), "");
  }
  normalized = normalized.replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/x/g, "");

  const piece = extractPiece(normalized, lang);
  const square = extractSquare(normalized);

  if (!square) return null;

  const sanPiece = extractSanPiece(normalized, square);
  const pieceLetter = piece ?? sanPiece ?? "";
  const idx = normalized.lastIndexOf(square);
  const prev = idx > 0 ? normalized[idx - 1] : "";
  const pawnCaptureFile = /^[a-h]$/.test(prev);

  if (takes) {
    if (!piece && pawnCaptureFile) return `${prev}x${square}`;
    return `${pieceLetter}x${square}`;
  }
  return `${pieceLetter}${square}`;
}