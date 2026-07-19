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

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type EngineProfile = {
  emotion: string;
  depth: number;
  skillLevel: number;
  elo: number;
};

type GameOutcome = "active" | "checkmate" | "stalemate" | "draw" | "gameover";
type CoachLlmConnection = "checking" | "connected" | "disconnected" | "disabled";

const DEFAULT_ENGINE_PROFILE: EngineProfile = {
  emotion: "neutral",
  depth: 12,
  skillLevel: 8,
  elo: 1450,
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

function estimateEmotionFromVideo(
  videoElement: HTMLVideoElement | null,
  msSinceLastMove: number,
): EmotionLabel {
  if (!videoElement || videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return "neutral";
  }

  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 18;
  const context = canvas.getContext("2d");

  if (!context) return "neutral";

  context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

  let totalBrightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const pixelCount = data.length / 4;
  const averageBrightness = totalBrightness / pixelCount;

  if (averageBrightness > 155 && msSinceLastMove > 2200) return "confident";
  if (msSinceLastMove < 4500) return "stressed";
  if (averageBrightness < 55) return "frustrated";
  if (averageBrightness > 130) return "focused";
  return "calm";
}

export default function ChessPage() {
  const chessRef = useRef(new Chess());
  const videoRef = useRef<HTMLVideoElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMoveTimestampRef = useRef<number>(0);

  const [gamePosition, setGamePosition] = useState(
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  );
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [emotion, setEmotion] = useState<EmotionLabel>("neutral");
  const [emotionMode, setEmotionMode] = useState<"auto" | "manual">("auto");
  const [engineProfile, setEngineProfile] = useState<EngineProfile>(
    DEFAULT_ENGINE_PROFILE,
  );
  const [gameOutcome, setGameOutcome] = useState<GameOutcome>("active");
  const [statusMessage, setStatusMessage] = useState("Sentio online.");
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [coachLlmConnection, setCoachLlmConnection] =
    useState<CoachLlmConnection>("checking");
  const [coachLlmDetail, setCoachLlmDetail] = useState("Checking LLM health...");
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

    return () => {
      document.body.style.overflow = "";
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (emotionMode !== "auto") return;

    const intervalId = window.setInterval(() => {
      const estimatedEmotion = estimateEmotionFromVideo(
        videoRef.current,
        Date.now() - lastMoveTimestampRef.current,
      );
      setEmotion(estimatedEmotion);
    }, 2200);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [emotionMode]);

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
        setEngineProfile(data.engineProfile);
      }

      if (data.botMove) {
        const chess = chessRef.current;
        const uciMove = data.botMove.toLowerCase();

        try {
          chess.move({
            from: uciMove.substring(0, 2),
            to: uciMove.substring(2, 4),
            promotion: uciMove.length === 5 ? uciMove[4] : undefined,
          });
        } catch {
          chess.move(uciMove);
        }

        setGamePosition(chess.fen());
        if (!updateGameOutcome(chess)) {
          setStatusMessage("Engine move completed.");
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

  function applyMove(from: string, to: string) {
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
      lastMoveTimestampRef.current = Date.now();
      setSelectedSquare(null);
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

  function handleSquareClick(square: string) {
    const chess = chessRef.current;
    if (gameOutcome !== "active") return;
    const pieceOnSquare = chess.get(square as Square);
    const activeColor = chess.turn();

    if (!selectedSquare) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
      }
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    const moved = applyMove(selectedSquare, square);
    if (!moved) {
      if (pieceOnSquare && pieceOnSquare.color === activeColor) {
        setSelectedSquare(square);
      } else {
        setSelectedSquare(null);
      }
    }
  }

  function handleBoardTouchEndCapture(event: React.TouchEvent<HTMLDivElement>) {
    if (!event.cancelable) {
      event.stopPropagation();
    }
  }

  async function handleAskCoach() {
    const question = chatInput.trim();
    if (!question || isCoachThinking) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
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
      };

      const coachMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: `${data.message}${
          data.suggestions?.length
            ? `\n${data.suggestions.join("\n")}`
            : ""
        }`,
      };
      setChatMessages((previous) => [...previous, coachMessage]);
    } catch (error) {
      const coachError: ChatMessage = {
        id: `assistant-error-${Date.now()}`,
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
    ? { [selectedSquare]: { backgroundColor: "rgba(245, 158, 11, 0.45)" } }
    : {};

  const chessboardOptions: ChessboardOptions = {
    id: "sentio-engine-board",
    position: gamePosition,
    onSquareClick: ({ square }) => {
      handleSquareClick(square);
    },
    onPieceClick: ({ square }) => {
      if (square) handleSquareClick(square);
    },
    squareStyles: customSquareStyles,
    allowDragging: false,
    animationDurationInMs: 200,
    boardStyle: { touchAction: "none" },
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <section className="relative flex flex-1 items-center justify-center p-6">
        <div
          className="aspect-square w-[560px] max-w-[92vw] rounded-lg bg-zinc-800 p-4 shadow-2xl touch-none"
          onTouchEndCapture={handleBoardTouchEndCapture}
        >
          <Chessboard options={chessboardOptions} />
        </div>

        <div className="fixed bottom-6 left-6 z-50 w-56 overflow-hidden rounded-xl border-2 border-zinc-700 bg-black shadow-xl">
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
      </section>

      <aside className="flex w-[360px] flex-col border-l border-zinc-800 bg-zinc-950 p-4">
        <h1 className="font-mono text-lg font-semibold text-amber-400">Sentio</h1>
        <p className="mt-1 text-xs text-zinc-400">{statusMessage}</p>

        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400">Emotion Mode</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
              value={emotionMode}
              onChange={(event) =>
                setEmotionMode(event.target.value as "auto" | "manual")
              }
            >
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-zinc-400">Detected Emotion</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs"
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
        </div>

        <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm">
          <p className="text-zinc-400">Adaptive Engine Profile</p>
          <p className="mt-2">Emotion: {engineProfile.emotion}</p>
          <p>Game: {gameOutcome}</p>
          <p>ELO: {engineProfile.elo}</p>
          <p>Depth: {engineProfile.depth}</p>
          <p>Skill: {engineProfile.skillLevel}</p>
          <p className="mt-2 text-xs text-zinc-500">
            {isBotThinking ? "Engine thinking..." : "Engine ready"}
          </p>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-md border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-400">Coach Chat</p>
            <span
              title={coachLlmDetail}
              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
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
            className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
          >
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-md p-2 text-xs whitespace-pre-line ${
                  message.role === "assistant"
                    ? "bg-zinc-800 text-zinc-200"
                    : "bg-amber-900/30 text-amber-100"
                }`}
              >
                {message.content}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask Sentio for advice..."
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => {
                void handleAskCoach();
              }}
              disabled={isCoachThinking || !chatInput.trim()}
              className="rounded bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-900 disabled:opacity-50"
            >
              {isCoachThinking ? "..." : "Send"}
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
