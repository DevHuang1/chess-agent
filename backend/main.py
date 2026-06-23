import os
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

# Target the precise file binary sitting in our root backend directory
local_binary_path = os.path.abspath("./stockfish")
print(f"Checking for Stockfish binary at: {local_binary_path}")

try:
    if os.path.exists(local_binary_path):
        stockfish = Stockfish(path=local_binary_path)
        print("🎯 Stockfish initialized successfully from project root folder!")
    else:
        raise FileNotFoundError(f"Binary file missing at {local_binary_path}")
except Exception as e:
    print(f"⚠️ Initialization Error: {e}")
    stockfish = None