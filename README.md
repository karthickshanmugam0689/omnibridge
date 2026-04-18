# OmniBridge — The Multi-modal Inclusion Engine

> HackKosice / Investech hackathon project.
> A local community help & resources app that works for **everyone** — voice-first for Mária (82, arthritis), translated in real time for Ahmad (29, refugee), and fully offline-capable for Jana (34, no data).

---

## The three personas

| Persona | Pain point | OmniBridge answer |
| --- | --- | --- |
| **Mária**, 82, arthritis | Can't type on tiny keyboards | 96 px mic button + 8-icon category grid, "Read aloud" on every card |
| **Ahmad**, 29, refugee, little Slovak | Feed is unreadable | Real-time Gemini translation (sk → en/ar/uk) cached per post, RTL for Arabic |
| **Jana**, 34, no mobile data | App breaks on the bus | PWA shell + Dexie cache + outbox; posts queued offline sync on reconnect |

## Tech stack

- **Vite + React + TypeScript** (pnpm)
- **Tailwind CSS** with a warm accessible palette + **Atkinson Hyperlegible** font
- **shadcn/ui** primitives (Radix) & **Lucide** icons
- **Zustand** (persisted) for language, profile, online state
- **react-i18next** with `sk` / `en` / `ar` / `uk` bundles + automatic RTL toggle
- **Dexie.js (IndexedDB)** — feed cache, outbox, translation cache
- **vite-plugin-pwa (Workbox)** — service worker, runtime caching for Supabase + Google Fonts
- **Supabase** (Postgres + realtime) — single `posts` table, no auth
- **Gemini 1.5 Flash** — one batched prompt returns `{en, ar, uk, category, simplified}` JSON
- **Web Speech API** (browser-native) for voice in/out

## Screens

1. **Feed** (`/`) — emoji-first cards with Read-aloud + "I can help"
2. **New Post** (`/new`) — giant 🎤 mic + 8-icon category grid
3. **Resources** (`/resources`) — pinned legal aid, free fridge, kitchen, clothing bank, etc.
4. **Settings** (`/settings`) — language picker + name & emoji profile

## Getting started

```bash
# 1. Install
pnpm install

# 2. Configure environment
cp .env.example .env
# then edit .env with your Supabase + Gemini keys

# 3. Create the Supabase database
#    In the Supabase SQL editor, run:
#      supabase/schema.sql
#      supabase/seed.sql

# 4. Run
pnpm dev

# 5. Build & preview
pnpm build
pnpm preview
```

The app runs fine **without** Supabase or Gemini configured — it falls back to Dexie-only mode with empty translations (Slovak only). That makes it friendly for offline demos and for developers who haven't set up their keys yet.

### Required environment variables

| Variable | What it is |
| --- | --- |
| `VITE_SUPABASE_URL` | Your Supabase project URL, e.g. `https://abcd.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe to ship in the client) |
| `VITE_GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) key (free tier works) |

## Project layout

```
src/
  App.tsx                  # Shell + routes + online/outbox wiring
  main.tsx                 # SW registration, router, i18n bootstrap
  i18n/                    # i18next init + sk/en/ar/uk JSON bundles
  store/useAppStore.ts     # Zustand (language, user, online, lastSyncedAt)
  lib/
    supabase.ts            # Client (optional — env-driven)
    db.ts                  # Dexie schema: posts, outbox, translationsCache
    types.ts               # Category, Post, OutboxItem, CATEGORY_EMOJI
    translate.ts           # Gemini 1.5 Flash wrapper, JSON output, Dexie-cached
    voice.ts               # Web Speech API wrapper (start/stop/transcript/speak)
    posts.ts               # refreshFeed, createPost, syncOutbox
    utils.ts               # cn(), timeAgo()
  components/
    OfflineBanner.tsx
    BottomNav.tsx
    PostCard.tsx
  screens/
    FeedScreen.tsx
    NewPostScreen.tsx
    ResourcesScreen.tsx
    SettingsScreen.tsx
supabase/
  schema.sql               # Posts table, indexes, RLS, realtime
  seed.sql                 # ~15 realistic Košice posts + pinned resources
public/
  favicon.svg
  icons/icon.svg           # PWA manifest icon (placeholder)
  icons/icon-maskable.svg
```

## Translation strategy

`lib/translate.ts` sends a single Slovak string to Gemini 1.5 Flash with
`responseMimeType: "application/json"` and a strict system prompt that returns:

```json
{ "en": "...", "ar": "...", "uk": "...", "category": "food", "simplified": "..." }
```

Results are written into `title_translations` / `body_translations` on the
Supabase row **and** into a Dexie `translations` table so later reads work
offline. If the Gemini key is missing we fall through to Slovak-only mode.

> **v2 pitch:** run [NLLB-200 distilled via `transformers.js`](https://huggingface.co/Xenova/nllb-200-distilled-600M) fully on-device, so the translation layer also works with zero network and covers Romani.

## Offline strategy

- Workbox **precaches** the app shell (JS, CSS, fonts).
- Feed + resources are **cached in Dexie** with a stale-while-revalidate read.
- Posts created offline go into a Dexie **outbox** and flush automatically on the `online` event (also re-tried on app start).
- A persistent **offline banner** shows "Offline — last updated Xh ago" and an outbox counter.

## Design system

- Font: **Atkinson Hyperlegible** (Google Fonts, loaded in `index.css`)
- Base size **18 px**, headings **28–36 px**
- Palette (CSS variables in `src/index.css`):

| Role | Hex |
| --- | --- |
| primary (amber) | `#E06B2A` |
| secondary (teal) | `#0F766E` |
| surface | `#FFFBF5` |
| ink | `#1A1A1A` |
| success | `#16A34A` |
| offline | `#F59E0B` |

- Minimum touch target **56 px**, primary mic button **96 px**
- `rounded-2xl`, soft shadows everywhere
- WCAG AAA contrast on primary text
- RTL automatically enabled when `ar` is selected (`<html dir="rtl">`)

## Deployment (Vercel)

1. Push to GitHub.
2. Import the repo in Vercel — framework preset **Vite** is auto-detected.
3. Add the three `VITE_*` env vars in Project Settings → Environment Variables.
4. Deploy. The generated Workbox service worker will be served from `/sw.js`.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Dev server with HMR |
| `pnpm build` | TypeScript check + production build + service worker |
| `pnpm preview` | Preview the production build locally |
| `pnpm lint` | ESLint |

## License

MIT — built for HackKosice 2026. Logos, seed resource names, and phone numbers in `supabase/seed.sql` are illustrative placeholders.
