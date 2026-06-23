"use client";

import { useState, useEffect, useRef } from "react";
import { Chess } from "chess.js";
import dynamic from "next/dynamic";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false },
) as any;

export default function ChessPage() {
  const chessRef = useRef(new Chess());
  const videoRef = useRef<HTMLVideoElement>(null);

  const [gamePosition, setGamePosition] = useState("start");
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setGamePosition(chessRef.current.fen());

    document.body.style.overflow = "hidden";

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
      });

    return () => {
      document.body.style.overflow = "";

      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  async function triggerBotTurn(currentFen: string) {
    try {
      const response = await fetch("http://localhost:8000/api/bot-move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fen: currentFen,
          emotion: "neutral",
        }),
      });

      if (!response.ok) {
        throw new Error("Backend response error");
      }

      const data = await response.json();

      if (data.botMove) {
        const chess = chessRef.current;

        try {
          chess.move(data.botMove.toLowerCase());
        } catch {
          chess.move({
            from: data.botMove.toLowerCase().substring(0, 2),
            to: data.botMove.toLowerCase().substring(2, 4),
            promotion: data.botMove.length === 5 ? data.botMove[4] : undefined,
          });
        }

        setGamePosition(chess.fen());
      }
    } catch (error) {
      console.error("Communication failure with Stockfish engine:", error);
    }
  }

  function onDrop(sourceSquare: string, targetSquare: string) {
    const chess = chessRef.current;

    try {
      const move = chess.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: "q",
      });

      if (!move) return false;

      const nextFen = chess.fen();

      setGamePosition(nextFen);
      triggerBotTurn(nextFen);

      return true;
    } catch (error) {
      console.error("Illegal move:", error);
      return false;
    }
  }

  if (!isClient) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-900 text-zinc-500">
        Loading System Interface...
      </div>
    );
  }

  return (
    <main
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-zinc-900 select-none"
      style={{
        touchAction: "none",
      }}
    >
      <div
        className="aspect-square w-[500px] max-w-[90vw] rounded-lg bg-zinc-800 p-4 shadow-2xl"
        style={{
          touchAction: "none",
        }}
      >
        <Chessboard
          id="stable-engine-board"
          position={gamePosition}
          onPieceDrop={onDrop}
          arePiecesDraggable={true}
          animationDuration={200}
        />
      </div>

      <div className="fixed bottom-6 right-6 z-50 w-48 overflow-hidden rounded-xl border-2 border-zinc-700 bg-black shadow-xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full scale-x-[-1] object-cover"
        />

        <div className="bg-zinc-800 p-1 text-center font-mono text-xs tracking-wider text-zinc-400">
          FEED_ACTIVE
        </div>
      </div>
    </main>
  );
}
