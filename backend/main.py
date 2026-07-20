import os
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from stockfish import Stockfish

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

local_binary_path = os.path.abspath("./stockfish")


EMOTION_STRENGTH_PROFILES: Dict[str, Dict[str, int]] = {
    "stressed": {"depth": 1, "skillLevel": 1, "elo": 1320},
    "frustrated": {"depth": 2, "skillLevel": 3, "elo": 1320},
    "calm": {"depth": 4, "skillLevel": 6, "elo": 1600},
    "neutral": {"depth": 6, "skillLevel": 10, "elo": 2000},
    "focused": {"depth": 8, "skillLevel": 15, "elo": 2600},
    "confident": {"depth": 10, "skillLevel": 20, "elo": 3190},
}
MIN_UCI_ELO = 1320
MAX_UCI_ELO = 3190


class MoveRequest(BaseModel):
    fen: str
    emotion: str = "neutral"


def resolve_strength_profile(emotion: str):
    normalized_emotion = emotion.strip().lower()
    if normalized_emotion not in EMOTION_STRENGTH_PROFILES:
        normalized_emotion = "neutral"
    profile = EMOTION_STRENGTH_PROFILES[normalized_emotion].copy()
    profile["elo"] = max(MIN_UCI_ELO, min(MAX_UCI_ELO, profile["elo"]))
    return normalized_emotion, profile


@app.post("/api/bot-move")
async def get_bot_move(request: MoveRequest):
    if not os.path.exists(local_binary_path):
        raise HTTPException(
            status_code=500, detail="Stockfish engine binary is missing on server."
        )

    try:
        emotion, profile = resolve_strength_profile(request.emotion)

        # Isolated Stockfish instance for this specific execution thread
        stockfish = Stockfish(
            path=local_binary_path,
            depth=profile["depth"],
            parameters={
                "Threads": 2,
                "Skill Level": profile["skillLevel"],
                "UCI_LimitStrength": True,
                "UCI_Elo": profile["elo"],
            },
        )

        if not stockfish.is_fen_valid(request.fen):
            # Some terminal positions may be flagged as invalid by is_fen_valid in
            # specific stockfish/python-stockfish combinations; set_fen_position is the
            # source-of-truth validation step.
            try:
                stockfish.set_fen_position(request.fen)
            except Exception:
                raise HTTPException(
                    status_code=400, detail="Invalid FEN position received."
                )
        else:
            stockfish.set_fen_position(request.fen)
        best_move = stockfish.get_best_move()

        if not best_move:
            return {
                "botMove": None,
                "status": "Checkmate or Draw",
                "engineProfile": {
                    "emotion": emotion,
                    "depth": profile["depth"],
                    "skillLevel": profile["skillLevel"],
                    "elo": profile["elo"],
                },
            }

        return {
            "botMove": best_move,
            "engineProfile": {
                "emotion": emotion,
                "depth": profile["depth"],
                "skillLevel": profile["skillLevel"],
                "elo": profile["elo"],
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine evaluation error: {str(e)}")