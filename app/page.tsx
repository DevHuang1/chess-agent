"use client";

import { useEffect, useRef, useState } from "react";
import { Chess, Square } from "chess.js";
import dynamic from "next/dynamic";
import type { ChessboardOptions } from "react-chessboard";

const BOT_MOVE_API_URL = "/api/bot-move";
const COACH_API_URL = "/api/coach";

type EmotionLabel =
  | "calm"
  | "focused"
  | "neutral"
  | "frustrated"
  | "stressed"
  | "confident";

const COACH_AUTO_ENCOURAGEMENT: Record<string, string[]> = {
  confident: [
    "You're playing with real confidence — love to see it. Keep the pressure on.",
    "Great energy! You're in control. Stay sharp.",
    "Love the swagger. Just don't get careless.",
  ],
  focused: [
    "You're locked in. That's how you win games.",
    "Nice concentration — keep calculating deep.",
    "Focused and sharp. You've got this.",
  ],
  neutral: [
    "Solid and steady. Good things will come.",
    "You're playing fine — trust your instincts.",
    "No panic. Just keep making good moves.",
  ],
  calm: [
    "You look relaxed — that's your best state to play in.",
    "Calm and collected. That's the way.",
    "Staying cool under pressure. Well played.",
  ],
  frustrated: [
    "Hey, you're doing better than you think. Take a breath.",
    "Don't be hard on yourself. One good move changes everything.",
    "Frustration is normal. Reset and focus on the next move.",
    "You've got this. Don't let one setback shake you.",
  ],
  stressed: [
    "Take a deep breath. You've handled tougher positions.",
    "You're feeling the pressure, but you're still in this.",
    "Slow down. You don't need to rush — think clearly.",
    "Trust yourself. You know more than you think.",
  ],
};

const BOT_REMARKS: Record<string, string[]> = {
  confident: [
    "Confidence looks good on you. Shame it won't save your king.",
    "You're feeling bold. I love breaking that.",
    "That swagger won't help when I'm done with you.",
    "Love the energy. Let me crush it.",
  ],
  focused: [
    "Sharp focus. I'll still outplay you.",
    "Calculating hard? So am I. I'm just better at it.",
    "You're locked in. Good. I prefer a challenge.",
    "Focused? Good. You'll need it to keep up.",
  ],
  neutral: [
    "Playing it cool? Let's see how long that lasts.",
    "I'm just getting started.",
    "Quiet now. Let's change that.",
    "Neutral energy. I'll take that as a challenge.",
  ],
  calm: [
    "Too relaxed. Let me fix that.",
    "Calm before the storm. Here it comes.",
    "You should be nervous.",
    "Serene. Unbothered. About to be embarrassed.",
  ],
  frustrated: [
    "I can feel the frustration. Makes you sloppy.",
    "Don't tilt. Actually, do. I love it.",
    "Rage makes you predictable.",
    "Take a breath. You're playing right into my hands.",
  ],
  stressed: [
    "You look stressed. Good.",
    "Pressure cooker. Let's see if you crack.",
    "Your play is getting shaky.",
    "I can smell the panic. Beautiful.",
  ],
};

const CHECK_REMARKS = [
  "Check. Squirm a little.",
  "Check. What are you gonna do about it?",
  "King in danger. Again. Stay focused.",
  "Check. Hope you saw that coming.",
];

const CAPTURE_REMARKS = [
  "Piece down. You okay?",
  "Thanks for the material.",
  "That piece is mine now. Deal with it.",
  "Oops. Did you need that?",
];

function pieceColorAtSquare(square: string, fen: string): 'w' | 'b' | null {
  const board = fen.split(' ')[0];
  const rows = board.split('/');
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - parseInt(square[1]);
  const row = rows[rank];
  if (!row) return null;
  let col = 0;
  for (const ch of row) {
    if (col > file) break;
    if (col === file) {
      if (ch >= '1' && ch <= '8') return null;
      return ch === ch.toUpperCase() ? 'w' : 'b';
    }
    if (ch >= '1' && ch <= '8') {
      col += parseInt(ch);
    } else {
      col++;
    }
  }
  return null;
}

function generateRemark(em: EmotionLabel, isCheck: boolean, isCapture: boolean): string {
  const pool = BOT_REMARKS[em] ?? BOT_REMARKS.neutral;
  let remark = pool[Math.floor(Math.random() * pool.length)];
  if (isCheck) {
    remark = CHECK_REMARKS[Math.floor(Math.random() * CHECK_REMARKS.length)];
  } else if (isCapture) {
    remark = CAPTURE_REMARKS[Math.floor(Math.random() * CAPTURE_REMARKS.length)];
  }
  return remark;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  bestMove?: { uci: string; san: string } | null;
};

type EngineProfile = {
  emotion: string;
  depth: number;
  skillLevel: number;
  elo: number;
};

type GameOutcome = "active" | "checkmate" | "stalemate" | "draw" | "gameover";
type CoachLlmConnection = "checking" | "connected" | "disconnected" | "disabled";

const EMOTION_PROFILES: Record<EmotionLabel, { depth: number; skillLevel: number; elo: number }> = {
  stressed: { depth: 1, skillLevel: 1, elo: 1320 },
  frustrated: { depth: 2, skillLevel: 3, elo: 1320 },
  calm: { depth: 4, skillLevel: 6, elo: 1600 },
  neutral: { depth: 6, skillLevel: 10, elo: 2000 },
  focused: { depth: 8, skillLevel: 15, elo: 2600 },
  confident: { depth: 10, skillLevel: 20, elo: 3190 },
};

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 font-mono text-zinc-500">
        Loading Sentio Interface...
      </div>
    ),
  },
);

type FaceApiModule = typeof import("@vladmandic/face-api");

const EXPRESSION_TO_EMOTION: Record<string, EmotionLabel> = {
  happy: "confident",
  neutral: "neutral",
  sad: "frustrated",
  angry: "frustrated",
  fearful: "stressed",
  surprised: "focused",
  disgusted: "stressed",
};

const EMOTION_BUFFER_SIZE = 3;
const emotionBuffer: EmotionLabel[] = [];

function mostFrequentInBuffer(): EmotionLabel | null {
  if (emotionBuffer.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const e of emotionBuffer) {
    counts[e] = (counts[e] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as EmotionLabel;
}

async function detectEmotionFromVideo(
  faceapi: FaceApiModule,
  videoElement: HTMLVideoElement | null,
): Promise<EmotionLabel> {
  if (
    !videoElement ||
    videoElement.videoWidth === 0 ||
    videoElement.videoHeight === 0
  ) {
    return "neutral";
  }

  try {
    const detection = await faceapi
      .detectSingleFace(
        videoElement,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 320 }),
      )
      .withFaceExpressions();

    if (!detection?.expressions) {
      return "neutral";
    }

    const sorted = detection.expressions.asSortedArray();
    const top = sorted[0];

    if (!top || top.probability < 0.35) {
      return "neutral";
    }

    return EXPRESSION_TO_EMOTION[top.expression] ?? "neutral";
  } catch {
    return "neutral";
  }
}

export default function ChessPage() {
  const chessRef = useRef(new Chess());
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMoveTimestampRef = useRef<number>(0);
  const faceapiRef = useRef<FaceApiModule | null>(null);
  const emotionHistoryRef = useRef<EmotionLabel[]>([]);
  const lastCoachAutoMessageRef = useRef(0);

  const [gamePosition, setGamePosition] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<EmotionLabel>("neutral");
  const [emotionMode, setEmotionMode] = useState<"auto" | "manual">("auto");
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [backendEngineProfile, setBackendEngineProfile] = useState<EngineProfile | null>(null);
  const engineProfile = backendEngineProfile ?? { emotion, ...(EMOTION_PROFILES[emotion] ?? EMOTION_PROFILES.neutral) };
  const [gameOutcome, setGameOutcome] = useState<GameOutcome>("active");
  const [statusMessage, setStatusMessage] = useState("Sentio online.");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [coachLlmConnection, setCoachLlmConnection] =
    useState<CoachLlmConnection>("checking");
  const [coachLlmDetail, setCoachLlmDetail] = useState("Checking LLM health...");
  const [botRemark, setBotRemark] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isCoachThinking, setIsCoachThinking] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "I am Sentio. I can coach your position, explain plans, and adapt engine strength based on your emotional state.",
    },
  ]);

  const postCoachEncouragementRef = useRef((em: EmotionLabel) => {
    const now = Date.now();
    if (now - lastCoachAutoMessageRef.current < 25000) return;
    lastCoachAutoMessageRef.current = now;
    const pool = COACH_AUTO_ENCOURAGEMENT[em] ?? COACH_AUTO_ENCOURAGEMENT.neutral;
    const text = pool[Math.floor(Math.random() * pool.length)];
    setChatMessages((prev) => [...prev, {
      id: `coach-auto-${now}`,
      role: "assistant",
      content: text,
    }]);
  });

  useEffect(() => {
    document.body.style.overflow = "hidden";
    lastMoveTimestampRef.current = Date.now();
    let mediaStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        mediaStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch((err) => {
        console.error("Webcam video source offline:", err);
        setStatusMessage("Webcam unavailable. Emotion fallback set to neutral.");
      });

    import("@vladmandic/face-api")
      .then((mod) => {
        Promise.all([
          mod.nets.tinyFaceDetector.loadFromUri("/models"),
          mod.nets.faceExpressionNet.loadFromUri("/models"),
        ])
          .then(() => {
            faceapiRef.current = mod;
            setModelsLoaded(true);
          })
          .catch((loadErr) => {
            console.error("Failed to load face-api models:", loadErr);
            setStatusMessage("Emotion models failed to load.");
          });
      })
      .catch((importErr) => {
        console.error("Failed to import face-api:", importErr);
      });

    return () => {
      document.body.style.overflow = "";
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (emotionMode !== "auto" || !faceapiRef.current || !modelsLoaded) return;

    const intervalId = window.setInterval(async () => {
      const api = faceapiRef.current;
      if (!api) return;

      const estimatedEmotion = await detectEmotionFromVideo(api, videoRef.current);
      emotionBuffer.push(estimatedEmotion);
      if (emotionBuffer.length > EMOTION_BUFFER_SIZE) {
        emotionBuffer.shift();
      }
      const smoothed = mostFrequentInBuffer();
      if (smoothed) {
        setEmotion(smoothed);
        emotionHistoryRef.current.push(smoothed);
        if (emotionHistoryRef.current.length > 7) {
          emotionHistoryRef.current.shift();
        }
      }
    }, 2200);

    return () => {
      window.clearInterval(intervalId);
      emotionBuffer.length = 0;
      emotionHistoryRef.current = [];
    };
  }, [emotionMode, modelsLoaded]);

  useEffect(() => {
    if (emotionMode === "auto") {
      postCoachEncouragementRef.current(emotion);
    }
  }, [emotion, emotionMode]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    let active = true;

    async function refreshCoachHealth() {
      try {
        const response = await fetch(COACH_API_URL, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Health endpoint failed (${response.status}).`);
        }

        const data = (await response.json()) as {
          enabled: boolean;
          connected: boolean;
          detail: string;
          model: string;
        };

        if (!active) return;

        if (!data.enabled) {
          setCoachLlmConnection("disabled");
          setCoachLlmDetail(data.detail);
          return;
        }

        setCoachLlmConnection(data.connected ? "connected" : "disconnected");
        setCoachLlmDetail(`${data.detail} Model: ${data.model}`);
      } catch (error) {
        if (!active) return;
        setCoachLlmConnection("disconnected");
        setCoachLlmDetail(
          error instanceof Error
            ? error.message
            : "Could not check LLM connection.",
        );
      }
    }

    void refreshCoachHealth();
    const intervalId = window.setInterval(() => {
      void refreshCoachHealth();
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  function updateGameOutcome(chess: Chess) {
    if (!chess.isGameOver()) {
      setGameOutcome("active");
      return false;
    }
    if (chess.isCheckmate()) {
      setGameOutcome("checkmate");
      setStatusMessage("Checkmate. Game over.");
      return true;
    }
    if (chess.isStalemate()) {
      setGameOutcome("stalemate");
      setStatusMessage("Stalemate. Game over.");
      return true;
    }
    if (chess.isDraw()) {
      setGameOutcome("draw");
      setStatusMessage("Draw. Game over.");
      return true;
    }
    setGameOutcome("gameover");
    setStatusMessage("Game over.");
    return true;
  }

  async function triggerBotTurn(currentFen: string) {
    try {
      setIsBotThinking(true);
      setStatusMessage("Sentio engine is calculating...");

      const response = await fetch(BOT_MOVE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: currentFen,
          emotion,
          strengthPreference: "adaptive",
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(data?.detail ?? "Backend response error");
      }

      const data = (await response.json()) as {
        botMove?: string | null;
        engineProfile?: EngineProfile;
        status?: string;
      };

      if (data.engineProfile) {
        setBackendEngineProfile(data.engineProfile);
      }

      if (data.botMove) {
        const chess = chessRef.current;
        const uciMove = data.botMove.toLowerCase();

        let isCapture = false;
        try {
          const from = uciMove.substring(0, 2);
          const to = uciMove.substring(2, 4);
          const target = chess.get(to as Square);
          isCapture = !!target && target.color === "w";
          chess.move({ from: from as Square, to: to as Square, promotion: uciMove.length === 5 ? uciMove[4] as "q" | "r" | "b" | "n" : undefined });
        } catch {
          chess.move(uciMove);
        }

        setGamePosition(chess.fen());
        if (!updateGameOutcome(chess)) {
          setStatusMessage("Engine move completed.");
          const isCheck = chess.inCheck();
          setBotRemark(generateRemark(emotion, isCheck, isCapture));
        } else {
          setBotRemark(chess.isCheckmate() ? "Checkmate. Better luck next time." : "Game over. I won.");
        }
      } else {
        setStatusMessage(data.status ?? "No move available.");
      }
    } catch (error) {
      console.error("Communication failure with Stockfish engine:", error);
      setStatusMessage(
        error instanceof Error ? error.message : "Engine communication failure.",
      );
    } finally {
      setIsBotThinking(false);
    }
  }

  function applyMove(from: string, to: string, now: number) {
    const chess = chessRef.current;
    try {
      if (chess.turn() !== "w") return false;

      const move = chess.move({
        from: from as Square,
        to: to as Square,
        promotion: "q",
      });

      if (!move) return false;

      const nextFen = chess.fen();
      lastMoveTimestampRef.current = now;
      setSelectedSquare(null);
      setLegalMoveSquares([]);
      setGamePosition(nextFen);
      setStatusMessage(`You played ${from}-${to}.`);

      if (updateGameOutcome(chess)) {
        return true;
      }

      void triggerBotTurn(nextFen);
      return true;
    } catch {
      return false;
    }
  }

  function handleSquareClick(square: string, now: number) {
    const chess = chessRef.current;
    if (gameOutcome !== "active") return;
    const pieceOnSquare = chess.get(square as Square);
    const activeColor = chess.turn();

    if (!selectedSquare) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveSquares(moves.map((m) => m.to));
      }
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalMoveSquares([]);
      return;
    }

    const moved = applyMove(selectedSquare, square, now);
    if (!moved) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
        const moves = chess.moves({ square: square as Square, verbose: true });
        setLegalMoveSquares(moves.map((m) => m.to));
      } else {
        setSelectedSquare(null);
        setLegalMoveSquares([]);
      }
    }
  }

  function executeCoachMove(uci: string, now: number) {
    if (gameOutcome !== "active") return;
    const chess = chessRef.current;
    if (chess.turn() !== "w") return;
    try {
      const move = chess.move({
        from: uci.substring(0, 2) as Square,
        to: uci.substring(2, 4) as Square,
        promotion: uci.length === 5 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
      });
      if (!move) return;
      const nextFen = chess.fen();
      lastMoveTimestampRef.current = now;
      setSelectedSquare(null);
      setLegalMoveSquares([]);
      setGamePosition(nextFen);
      setStatusMessage(`Coach played ${move.from}-${move.to}.`);
      if (updateGameOutcome(chess)) return;
      void triggerBotTurn(nextFen);
    } catch {
      // invalid move
    }
  }

  function handleBoardTouchEndCapture(event: React.TouchEvent<HTMLDivElement>) {
    if (!event.cancelable) {
      event.stopPropagation();
    }
  }

  async function handleAskCoach(now: number) {
    const question = chatInput.trim();
    if (!question || isCoachThinking) return;

    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: "user",
      content: question,
    };

    setChatMessages((previous) => [...previous, userMessage]);
    setChatInput("");

    try {
      setIsCoachThinking(true);
      const response = await fetch(COACH_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen: chessRef.current.fen(),
          emotion,
          recentEmotions: emotionHistoryRef.current,
          question,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { detail?: string }
          | null;
        throw new Error(data?.detail ?? "Coach service unavailable.");
      }

      const data = (await response.json()) as {
        message: string;
        suggestions?: string[];
        bestMove?: { uci: string; san: string } | null;
      };

      const coachMessage: ChatMessage = {
        id: `assistant-${now}`,
        role: "assistant",
        bestMove: data.bestMove ?? undefined,
        content: `${data.message}${
          data.suggestions?.length
            ? `\n${data.suggestions.join("\n")}`
            : ""
        }`,
      };
      setChatMessages((previous) => [...previous, coachMessage]);
    } catch (error) {
      const coachError: ChatMessage = {
        id: `assistant-error-${now}`,
        role: "assistant",
        content:
          error instanceof Error
            ? error.message
            : "Coach service is currently unavailable.",
      };
      setChatMessages((previous) => [...previous, coachError]);
    } finally {
      setIsCoachThinking(false);
    }
  }

  const customSquareStyles = selectedSquare
    ? {
        [selectedSquare]: { backgroundColor: "rgba(245, 158, 11, 0.45)" },
        ...Object.fromEntries(
          legalMoveSquares.map((sq) => {
            const color = pieceColorAtSquare(sq, gamePosition);
            if (color && color !== "w") {
              return [sq, { boxShadow: "inset 0 0 0 4px rgba(239,68,68,0.5)", borderRadius: "0" }];
            }
            return [sq, { background: "radial-gradient(circle, rgba(34,197,94,0.5) 25%, transparent 25%)" }];
          }),
        ),
      }
    : {};

  const chessboardOptions: ChessboardOptions = {
    id: "sentio-engine-board",
    position: gamePosition,
    onSquareClick: ({ square }) => {
      // eslint-disable-next-line react-hooks/purity
      handleSquareClick(square, Date.now());
    },
    onPieceClick: ({ square }) => {
      // eslint-disable-next-line react-hooks/purity
      if (square) handleSquareClick(square, Date.now());
    },
    squareStyles: customSquareStyles,
    allowDragging: false,
    animationDurationInMs: 200,
    boardStyle: { touchAction: "none" },
  };

  const gameResultText =
    gameOutcome === "checkmate"
      ? gamePosition.split(' ')[1] === "b"
        ? "You Win!"
        : "You Lose"
      : gameOutcome === "stalemate"
        ? "Stalemate - Draw"
        : gameOutcome === "draw"
          ? "Draw"
          : null;

  function resetGame() {
    const newChess = new Chess();
    chessRef.current = newChess;
    setGamePosition(newChess.fen());
    setGameOutcome("active");
    setSelectedSquare(null);
    setLegalMoveSquares([]);
    setStatusMessage("New game started.");
  }

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <section className="flex flex-1 flex-col">
        <div className="flex items-center gap-5 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
          <span className="font-mono text-base font-semibold text-amber-400">Sentio</span>
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span>Emotion</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              value={emotionMode}
              onChange={(event) =>
                setEmotionMode(event.target.value as "auto" | "manual")
              }
            >
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
              value={emotion}
              disabled={emotionMode === "auto"}
              onChange={(event) => setEmotion(event.target.value as EmotionLabel)}
            >
              <option value="calm">Calm</option>
              <option value="focused">Focused</option>
              <option value="neutral">Neutral</option>
              <option value="frustrated">Frustrated</option>
              <option value="stressed">Stressed</option>
              <option value="confident">Confident</option>
            </select>
          </div>
          <div className="h-5 w-px bg-zinc-700" />
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <span className="text-zinc-400">Engine</span>
            <span className="text-zinc-300">{engineProfile.emotion}</span>
            <span className="text-amber-400 font-medium">{engineProfile.elo}</span>
            <span>depth {engineProfile.depth}</span>
            <span>skill {engineProfile.skillLevel}</span>
            {isBotThinking && (
              <span className="text-zinc-500 animate-pulse">thinking...</span>
            )}
          </div>
          <div className="flex-1" />
          <span className="text-sm text-zinc-600">{statusMessage}</span>
        </div>

        <div className="flex items-start justify-center gap-6 pt-16 px-6">
          <div
            className="aspect-square w-[700px] max-w-[92vw] rounded-lg bg-zinc-800 p-4 shadow-2xl touch-none"
            onTouchEndCapture={handleBoardTouchEndCapture}
          >
            <Chessboard options={chessboardOptions} />
          </div>
          <div className="w-72 h-80 shrink-0 overflow-hidden rounded-xl border-2 border-zinc-700 bg-black shadow-xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full scale-x-[-1] object-cover"
            />
            <div className="bg-zinc-800 p-1 text-center font-mono text-xs tracking-wider text-zinc-400">
              FACE FEED
            </div>
          </div>
        </div>

        {botRemark && (
          <div className="px-6 pb-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-5 py-3 text-sm text-zinc-300 italic">
              <span className="text-amber-500 font-semibold not-italic">Sentio: </span>
              {botRemark}
            </div>
          </div>
        )}
      </section>

      <aside className="flex w-[480px] flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <h1 className="font-mono text-lg font-semibold text-amber-400">Sentio</h1>
        <p className="mt-1 text-sm text-zinc-400">{statusMessage}</p>

        <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-md border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-lg text-zinc-300 font-medium">Coach Chat</p>
            <span
              title={coachLlmDetail}
              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                coachLlmConnection === "connected"
                  ? "bg-emerald-900/40 text-emerald-300"
                  : coachLlmConnection === "disabled"
                    ? "bg-zinc-700 text-zinc-300"
                    : coachLlmConnection === "checking"
                      ? "bg-amber-900/40 text-amber-300"
                      : "bg-rose-900/40 text-rose-300"
              }`}
            >
              {coachLlmConnection === "connected"
                ? "LLM connected"
                : coachLlmConnection === "disabled"
                  ? "LLM disabled"
                  : coachLlmConnection === "checking"
                    ? "LLM checking"
                    : "LLM disconnected"}
            </span>
          </div>
          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
          >
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-md ${
                  message.role === "assistant"
                    ? "bg-zinc-800 text-zinc-200"
                    : "bg-amber-900/30 text-amber-100"
                }`}
              >
                <div className="p-3 text-base leading-relaxed whitespace-pre-line">
                  {message.content}
                </div>
                {message.bestMove && (
                  <div className="border-t border-zinc-700/50 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => executeCoachMove(message.bestMove!.uci, Date.now())}
                      className="w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
                    >
                      Play {message.bestMove.san}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleAskCoach(Date.now());
                }
              }}
              placeholder="Ask Sentio for advice..."
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-base text-zinc-100 outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => {
                void handleAskCoach(Date.now());
              }}
              disabled={isCoachThinking || !chatInput.trim()}
              className="rounded bg-amber-500 px-4 py-2.5 text-base font-semibold text-zinc-900 disabled:opacity-50"
            >
              {isCoachThinking ? "..." : "Send"}
            </button>
          </div>
        </div>
      </aside>

      {gameResultText && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-8 text-center shadow-2xl">
            <p className="text-3xl font-bold text-zinc-100">{gameResultText}</p>
            <button
              type="button"
              onClick={resetGame}
              className="mt-6 rounded-lg bg-amber-500 px-6 py-3 text-lg font-semibold text-zinc-900 hover:bg-amber-400"
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
