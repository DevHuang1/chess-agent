import { Chess } from "chess.js";
import { NextResponse } from "next/server";

type CoachRequest = {
  fen: string;
  emotion?: string;
  question?: string;
};

type CoachMeta = {
  emotion: string;
  sideToMove: string;
  legalMoveCount: number;
  inCheck: boolean;
  gameOver: boolean;
};

type CoachReply = {
  message: string;
  suggestions: string[];
  meta: CoachMeta;
};

type CoachHealth = {
  enabled: boolean;
  connected: boolean;
  detail: string;
  model: string;
  baseUrl: string;
};

type LlmChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

const EMOTION_TONE: Record<string, string> = {
  calm: "You are steady. Keep building small advantages.",
  focused: "Your focus is strong. Calculate one move deeper before committing.",
  neutral: "Solid tempo. Keep pieces coordinated and avoid rushed pawn pushes.",
  frustrated: "Take one breath and simplify. Look for forcing moves first.",
  stressed: "Slow down and prioritize king safety over tactics.",
  confident:
    "Great confidence. Stay objective and watch for tactical blunders.",
};

const COACH_LLM_ENABLED = process.env.COACH_LLM_ENABLED === "true";
const COACH_LLM_BASE_URL =
  process.env.COACH_LLM_BASE_URL ?? "http://127.0.0.1:1234/v1";
const COACH_LLM_MODEL = process.env.COACH_LLM_MODEL ?? "qwen2.5-7b-instruct";
const COACH_LLM_API_KEY = process.env.COACH_LLM_API_KEY;

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (COACH_LLM_API_KEY) {
    headers.Authorization = `Bearer ${COACH_LLM_API_KEY}`;
  }
  return headers;
}

function buildFallbackReply(
  emotion: string,
  sideToMove: string,
  inCheck: boolean,
  gameOver: boolean,
  legalMoves: ReturnType<Chess["moves"]>,
  question?: string,
): CoachReply {
  const primaryAdvice = gameOver
    ? "Game over reached. Review critical turning points and missed tactics."
    : inCheck
      ? `${sideToMove} is in check. First find all legal escapes, then choose the safest continuation.`
      : legalMoves.length <= 8
        ? `Position is forcing (${legalMoves.length} legal moves). Calculate concrete lines before moving.`
        : `Position is flexible (${legalMoves.length} legal moves). Improve your worst-placed piece.`;

  const candidateMoves = legalMoves.slice(0, 3).map((move) => move.san);
  const toneAdvice = EMOTION_TONE[emotion] ?? EMOTION_TONE.neutral;
  const questionSuffix =
    question && question.trim()
      ? `You asked: "${question.trim()}". Focus answer: evaluate king safety, loose pieces, and checks-captures-threats.`
      : "Tip: before each move, scan checks, captures, and threats for both sides.";

  return {
    message: `${toneAdvice} ${primaryAdvice} ${questionSuffix}`,
    suggestions: candidateMoves.map(
      (san, index) => `Candidate ${index + 1}: ${san}`,
    ),
    meta: {
      emotion,
      sideToMove,
      legalMoveCount: legalMoves.length,
      inCheck,
      gameOver,
    },
  };
}
function isGeneralQuery(question?: string): boolean {
  if (!question || !question.trim()) return false;

  // 1. Vocabulary terms that explicitly target chess context
  const chessKeywords = [
    "move",
    "fen",
    "check",
    "mate",
    "castle",
    "tactic",
    "line",
    "plan",
    "pawn",
    "knight",
    "bishop",
    "rook",
    "queen",
    "king",
    "board",
    "position",
    "square",
    "capture",
    "attack",
    "defend",
    "win",
    "lose",
    "blunder",
    "threat",
    "play",
    "game",
    "white",
    "black",
    "evaluation",
    "pieces",
    "fork",
    "pin",
    "opening",
    "gambit",
    "endgame",
    "stockfish",
    "analyze",
    "what now",
  ];

  const lowerQuestion = question.toLowerCase().trim();

  // Check if it contains any chess vocabulary
  const hasChessKeywords = chessKeywords.some((keyword) =>
    lowerQuestion.includes(keyword),
  );

  // 2. Regex to catch raw algebraic chess moves typed alone (e.g., "e4", "Nf3", "O-O", "exd5")
  const chessMoveRegex =
    /^[a-h][1-8]$|^[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?$|^O-O(-O)?$/i;
  const isRawMove = chessMoveRegex.test(lowerQuestion);

  // It's a general conversation if it has NO chess keywords AND isn't a standalone chess move notation
  return !hasChessKeywords && !isRawMove;
}

async function generateLlmCoachMessage(
  payload: CoachRequest,
  fallback: CoachReply,
): Promise<string> {
  const question = payload.question?.trim();
  const isGeneral = isGeneralQuery(question);

  const systemContent = isGeneral
    ? "You are a helpful, direct, and brilliant AI assistant. Provide a highly accurate and thorough response to the user's question, completely ignoring any ongoing chess gameplay context."
    : "You are Sentio, an empathetic chess coach. Respond with final coaching only. Do not output hidden reasoning.";

  const userContent = isGeneral
    ? question!
    : [
        `FEN: ${payload.fen}`,
        `Emotion: ${fallback.meta.emotion}`,
        `Side to move: ${fallback.meta.sideToMove}`,
        `In check: ${fallback.meta.inCheck}`,
        `Game over: ${fallback.meta.gameOver}`,
        `Legal move count: ${fallback.meta.legalMoveCount}`,
        `Candidate moves: ${fallback.suggestions.join(", ") || "none"}`,
        `Question: ${question || "Give me the best coaching advice for this position."}`,
        "Respond in plain language with: 1) quick evaluation 2) best practical plan 3) one concrete tactical warning.",
      ].join("\n");

  const response = await fetch(`${COACH_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      model: COACH_LLM_MODEL,
      temperature: isGeneral ? 0.7 : 0.35,
      max_tokens: isGeneral ? 600 : 220,
      messages: [
        {
          role: "system",
          content: systemContent,
        },
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
    cache: "no-store",
  });

  const rawBody = await response.text();
  let parsedBody: LlmChatCompletionResponse;

  try {
    parsedBody = JSON.parse(rawBody) as LlmChatCompletionResponse;
  } catch {
    throw new Error("LM Studio returned invalid JSON.");
  }

  if (!response.ok) {
    throw new Error(
      parsedBody.error?.message ??
        `LM Studio request failed with status ${response.status}.`,
    );
  }

  const message = parsedBody.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (content) return content;

  const reasoningContent = message?.reasoning_content?.trim();
  if (reasoningContent) {
    throw new Error(
      "Model returned reasoning-only output. In LM Studio, disable thinking mode for this model preset.",
    );
  }

  throw new Error("LM Studio returned an empty response.");
}

async function getCoachHealth(): Promise<CoachHealth> {
  if (!COACH_LLM_ENABLED) {
    return {
      enabled: false,
      connected: false,
      detail: "LLM coach is disabled by configuration.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
    };
  }

  try {
    const response = await fetch(`${COACH_LLM_BASE_URL}/models`, {
      method: "GET",
      headers: {
        ...getAuthHeaders(),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return {
        enabled: true,
        connected: false,
        detail: `LM Studio health check failed with status ${response.status}.`,
        model: COACH_LLM_MODEL,
        baseUrl: COACH_LLM_BASE_URL,
      };
    }

    return {
      enabled: true,
      connected: true,
      detail: "LM Studio reachable.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
    };
  } catch (error) {
    return {
      enabled: true,
      connected: false,
      detail:
        error instanceof Error ? error.message : "Could not reach LM Studio.",
      model: COACH_LLM_MODEL,
      baseUrl: COACH_LLM_BASE_URL,
    };
  }
}

export async function GET() {
  const health = await getCoachHealth();
  return NextResponse.json(health);
}

export async function POST(request: Request) {
  let payload: CoachRequest;

  try {
    payload = (await request.json()) as CoachRequest;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.fen || typeof payload.fen !== "string") {
    return NextResponse.json(
      { detail: "Request body must include a valid fen string." },
      { status: 400 },
    );
  }

  const emotion = (payload.emotion ?? "neutral").trim().toLowerCase();

  let chess: Chess;
  try {
    chess = new Chess(payload.fen);
  } catch {
    return NextResponse.json(
      { detail: "Invalid FEN position." },
      { status: 400 },
    );
  }

  const legalMoves = chess.moves({ verbose: true });
  const sideToMove = chess.turn() === "w" ? "White" : "Black";
  const inCheck = chess.inCheck();
  const gameOver = chess.isGameOver();

  const fallback = buildFallbackReply(
    emotion,
    sideToMove,
    inCheck,
    gameOver,
    legalMoves,
    payload.question,
  );

  if (!COACH_LLM_ENABLED) {
    return NextResponse.json(fallback);
  }

  try {
    const llmMessage = await generateLlmCoachMessage(payload, fallback);
    return NextResponse.json({
      ...fallback,
      message: llmMessage,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Failed to query LM Studio.";
    return NextResponse.json({
      ...fallback,
      message: `${fallback.message}\n\n(LLM fallback active: ${detail})`,
    });
  }
}
