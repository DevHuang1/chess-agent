const PIECE_MAP: Record<string, Record<string, string>> = {
  en: { pawn: "", knight: "N", bishop: "B", rook: "R", queen: "Q", king: "K" },
  es: { peón: "", caballo: "N", alfil: "B", torre: "R", dama: "Q", rey: "K" },
  fr: { pion: "", cavalier: "N", fou: "B", tour: "R", dame: "Q", roi: "K" },
  de: { bauer: "", springer: "N", läufer: "B", turm: "R", dame: "Q", könig: "K" },
  it: { pedone: "", cavallo: "N", alfiere: "B", torre: "R", regina: "Q", re: "K" },
  pt: { peão: "", cavalo: "N", bispo: "B", torre: "R", rainha: "Q", rei: "K" },
};

const FILLER_WORDS = ["to", "on", "at", "the", "a", "an", "square", "en", "à", "al", "el", "la", "le", "der", "die", "das", "il", "lo", "um", "uma", "o", "os", "as"];

function normalizeText(text: string, lang: string): string {
  let normalized = text.toLowerCase().trim();
  normalized = normalized.replace(/[^a-zà-ÿœæéèêëîïôöùûüçñáéíóúäöüß0-9\s-]/g, "");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function extractSquare(text: string): string | null {
  const match = text.match(/\b([a-h][1-8])\b/);
  return match ? match[1] : null;
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

function extractPiece(text: string, lang: string): string | null {
  const map = PIECE_MAP[lang] ?? PIECE_MAP.en;
  for (const [name, letter] of Object.entries(map)) {
    if (text.includes(name)) return letter;
  }
  return null;
}

export function parseChessMove(text: string, lang: string = "en"): string | null {
  const castle = detectCastle(text);
  if (castle) return castle;

  let normalized = normalizeText(text, lang);

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

  const pieceLetter = piece ?? "";
  const separator = takes ? "x" : "";
  return `${pieceLetter}${separator}${square}`;
}