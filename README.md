# Chilli Farm IoT Dashboard

## Cara run kali pertama

1. Install dependencies:
   ```bash
   npm install
   ```

2. `.env.local` dah ada Supabase URL + anon key. Tambah `LLM_API_KEY` awak
   sendiri (Gemini dari aistudio.google.com/apikey, atau Anthropic key)
   kalau nak feature "Ask the Farm" jalan.

3. **Penting:** pastikan awak dah buat satu user login dalam Supabase
   (Authentication → Users → Add user) — guide asal Step 2.6. Dashboard
   akan redirect ke `/login` kalau tiada session aktif.

4. Pastikan RLS policies (Step 2.5 dalam guide) dah di-run dalam Supabase
   SQL Editor, dan **Realtime dah enable** untuk table `readings`,
   `device_state`, `ai_scores`, `ai_insights`
   (Database → Replication di Supabase dashboard).

5. Run dev server:
   ```bash
   npm run dev
   ```
   Buka http://localhost:3000 — patut redirect ke `/login` dulu.

## Struktur fail

```
app/
  layout.js          root layout
  page.js             renders Dashboard (protected)
  globals.css         tailwind imports
  login/page.js       login form
  api/ask-farm/route.js   server route, calls LLM, keeps key server-side
components/
  Dashboard.js         main dashboard UI + all data fetching
lib/
  supabase.js          browser supabase client (anon key)
.env.local              Supabase URL/key + LLM key (jangan commit!)
```

## Deploy ke Vercel

1. Push repo ni ke GitHub.
2. Vercel → Import Project → pilih repo.
3. Dalam Vercel project settings → Environment Variables, tambah:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `LLM_API_KEY`
4. Deploy.
