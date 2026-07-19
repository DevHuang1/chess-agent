This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Run the frontend:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

Run the Python Stockfish backend:

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## Environment variables

Copy the example file and adjust values as needed:

```bash
cp .env.example .env.local
```

- `BOT_MOVE_API_URL`: URL for the Python Stockfish backend endpoint used by Next.js API route (`/api/bot-move`).

If you see `ERR_CONNECTION_REFUSED`, your backend is not running. Start it on port `8000` (or update `BOT_MOVE_API_URL`).

## Sentio MVP capabilities

- Camera feed panel for computer-vision input surface
- Emotion-aware adaptive engine profile (depth, skill, ELO)
- Chessboard play against Stockfish
- Natural-language coaching chat via `/api/coach`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
