# InstaFacts

Vercel-ready Vite + React + Tailwind scaffold. Your app is already in `src/App.tsx`.

## Dev
```bash
npm install
npm run dev
# open http://localhost:5173
```

## Build
```bash
npm run build
npm run preview
```

## Deploy (Vercel)
1. Push this folder to a **new GitHub repo**.
2. On vercel.com: **New Project → Import** the repo. Vercel auto-detects Vite.
3. Add env vars (optional for Supabase):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.
