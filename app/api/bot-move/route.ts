import { NextResponse } from "next/server";

const BACKEND_BOT_MOVE_API_URL =
  process.env.BOT_MOVE_API_URL ?? "http://127.0.0.1:8000/api/bot-move";

type MoveRequest = {
  fen: string;
  emotion?: string;
  strengthPreference?: "adaptive" | "gentle" | "challenging";
};

export async function POST(request: Request) {
  let payload: MoveRequest;

  try {
    payload = (await request.json()) as MoveRequest;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.fen || typeof payload.fen !== "string") {
    return NextResponse.json(
      { detail: "Request body must include a valid fen string." },
      { status: 400 },
    );
  }

  const emotion =
    typeof payload.emotion === "string" ? payload.emotion : "neutral";
  const strengthPreference =
    payload.strengthPreference === "gentle" ||
    payload.strengthPreference === "challenging"
      ? payload.strengthPreference
      : "adaptive";

  let backendResponse: Response;

  try {
    backendResponse = await fetch(BACKEND_BOT_MOVE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fen: payload.fen,
        emotion,
        strengthPreference,
      }),
      cache: "no-store",
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? `Could not reach bot backend at ${BACKEND_BOT_MOVE_API_URL}. ${error.message}`
        : `Could not reach bot backend at ${BACKEND_BOT_MOVE_API_URL}.`;

    return NextResponse.json({ detail }, { status: 503 });
  }

  const responseText = await backendResponse.text();
  let parsedBody: unknown = null;

  if (responseText) {
    try {
      parsedBody = JSON.parse(responseText) as unknown;
    } catch {
      return NextResponse.json(
        { detail: "Bot backend returned invalid JSON." },
        { status: 502 },
      );
    }
  }

  if (!backendResponse.ok) {
    const detail =
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      "detail" in parsedBody &&
      typeof (parsedBody as { detail: unknown }).detail === "string"
        ? (parsedBody as { detail: string }).detail
        : "Bot backend error.";

    return NextResponse.json({ detail }, { status: backendResponse.status });
  }

  return NextResponse.json(parsedBody, { status: 200 });
}
