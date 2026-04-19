# OmniBridge — 3-minute hackathon pitch

> Target runtime: **180 seconds**. Spoken word count: ~440. Keep it conversational, don't read.

---

## 0:00 – 0:20 · Hook (one sentence problem, one sentence solution)

> "Imagine you're 78, your pharmacy is closed, you don't have family nearby — and your phone only speaks a language you barely read.
> That is an ordinary Tuesday for thousands of elderly neighbours and newly-arrived refugees in places like Košice.
>
> **OmniBridge** is a voice-first, offline-capable community app that matches them, in real time, with a neighbour who can help — in their own language."

_Soundbite:_ **"Not a feed. A matchmaker."**

---

## 0:20 – 0:45 · Problem (make it vivid, then make it specific)

> "Most help apps were built for tech-comfortable 30-year-olds. They assume you read English, have a stable data plan, can type, and remember passwords.
>
> Our users can't. So we flipped every default:
>
> - **Language** — Slovak, English, Arabic, Ukrainian, translated automatically.
> - **Voice** — one giant mic button, no forms.
> - **Offline** — works on a bus, in a basement, on a pre-paid SIM.
> - **Matching** — the app finds the right neighbour for you, not a feed to scroll."

---

## 0:45 – 2:15 · Live demo (90 seconds — this is the bulk of the pitch)

**Hand your phone / screen-share the PWA. Script below:**

### Beat 1 (~20 s) — Ask in Arabic, see it in Slovak

- Tap the big mic → say _"أحتاج مساعدة لشراء أدوية"_ (I need help buying medicine).
- Show the post appears **instantly** with the Arabic text.
- Switch language to Slovak in the top bar → the same post is now readable as _"Potrebujem pomoc s kúpou liekov"_.

> "That translation happened server-side with an LLM — but notice the UI didn't block. The post was already in the feed and a notification was already sent before the translation came back."

### Beat 2 (~25 s) — The match happens

- On a **second device / incognito window** (pre-seeded helper profile with "groceries + Mon/Tue/Wed mornings"), the push notification arrives:
  **"🚨 Marta needs help with groceries."**
- Tap it → one giant button: **"Yes, I can help."** Tap.
- Back on the first device, the asker sees: **"Jana is ready to help you."** → tap to open a private 1-to-1 thread.

> "That's not a chat app. That's a **matching engine** — we look at who's available, in the right category, at the right time of day, in their local timezone, and ping only them."

### Beat 3 (~20 s) — Urgent escalation

- Post a new request and toggle the **red 🚨 Urgent** button.
- On the helper phone, even though it's technically "evening off-hours", the push still rings with a distinct vibration pattern.

> "For emergencies, availability doesn't matter. This is the only app I know of where _time of day_ is part of the matching logic at all."

### Beat 4 (~20 s) — The thank-you moment

- Back on the first device, tap **"Mark as solved"** and choose the helper who offered.
- The helper phone — still open — **bursts into confetti**, plays a chime, and shows **+10 points**.

> "That's real Supabase Realtime, triggered by the resolve API, firing canvas-confetti on the helper's device — even if they never opened the app. Gamification that actually means something: 'a human was helped because of you'."

---

## 2:15 – 2:40 · The wow stack (say this fast, it's the judge-proof bit)

> "Under the hood: a React PWA with an offline IndexedDB cache and outbox, a custom service worker for push-when-closed, Supabase for state and Realtime, Vercel Edge + Node functions for translation and matching, **and** on-device cross-language embeddings — so search works offline across all four languages.
>
> We do server-side Gemini translation in **parallel in the background** so the UI never waits. We use `keepalive: true` on fetches so notifications survive a phone locking. We pass client-local timezone so nobody gets filtered out because Vercel is in UTC.
>
> Every tiny detail is tuned for one user: the 78-year-old who needed help on a Tuesday."

---

## 2:40 – 3:00 · Close — the ask & the impact

> "This could live in every rural municipality in Central Europe tomorrow. It's a PWA, it's one deployment, and it speaks your grandmother's language.
>
> **OmniBridge turns a neighbourhood back into a neighbourhood.**
> Thank you."

_Mic drop. Smile. Breathe._

---

# Demo click-path cheatsheet (print this!)

**Pre-flight (do BEFORE the pitch):**

1. Second device / incognito signed in as **"Jana"** with:
   - Language: Slovak
   - Helper mode ON
   - Categories: ☑️ Groceries, ☑️ Medication
   - Availability: ☑️ Mon/Tue/Wed mornings + evenings
   - Push notifications: **allowed**
2. First device signed in as **"Marta"**, language Arabic.
3. Both devices have the latest build (https://omnibridge-sooty.vercel.app).
4. Have **an extra helper-side post already solved earlier** so confetti isn't the first impression — show archive exists.
5. Charge both phones. Seriously.

**During the demo (don't lose the thread!):**

| t      | action                                                  | device     |
|--------|---------------------------------------------------------|------------|
| 0:45   | Tap mic, speak Arabic request                           | Marta      |
| 1:00   | Switch UI language to Slovak, show auto-translation     | Marta      |
| 1:10   | Look for the notification                               | Jana       |
| 1:18   | Tap "Yes, I can help"                                   | Jana       |
| 1:25   | Show "Jana is ready to help you"                        | Marta      |
| 1:35   | Post urgent request, tap 🚨 toggle                       | Marta      |
| 1:45   | Urgent push arrives with distinct vibration             | Jana       |
| 2:00   | Mark previous post as solved, thank Jana               | Marta      |
| 2:05   | CONFETTI + points                                       | Jana       |

**If anything breaks:** keep talking, tap the post to open the thread, show the private message flow, pivot to the archive. Never apologise — **"and of course it also works offline"** and swipe airplane mode on.

---

# Q&A prep (most likely judge questions)

**"How is this different from a Facebook group?"**
> "A Facebook group is a feed; somebody has to happen to scroll it at the right moment. OmniBridge _reaches out_ to the right specific neighbour based on what they said they're good at and when they said they're free. That's the difference between a notice board and matchmaking."

**"Who pays for the LLM calls?"**
> "Current build uses Gemini 1.5 Flash via Google's free tier — roughly $0 for a village. At municipal scale it's single-digit cents per post. We also cache translations in Dexie and on Supabase so the same message is never translated twice."

**"What about abuse / bad actors?"**
> "Three layers. (1) Account-less design means the unit of identity is the device's clientId — a griefer can be silently shadow-muted. (2) The asker always has to _invite_ a specific helper into the DM — there's no open chat. (3) Resolving a post is the only way to earn points, so there's a natural positive-sum dynamic. We'd add proper moderation before scaling past a single neighbourhood."

**"Why a PWA, not native?"**
> "Because our users are refugees and elderly — we cannot assume an App Store account, Apple ID, credit card, or 500 MB of free space. A PWA works from a URL on any phone ever made, installs in one tap, and falls back to the browser if install fails."

**"What's next?"**
> "Three things: (1) SMS fallback for users without smartphones at all — Twilio integration is already stubbed. (2) Partnering with a Košice NGO to seed 100 real helper profiles. (3) Adding audio messages for full voice-only accessibility."

---

# One-liner for the judges' one-liner sheet

> **OmniBridge** — a voice-first, offline-capable, multilingual neighbourhood matching service that pairs elderly and refugee neighbours with volunteers in real time. PWA. Supabase. Gemini. Slovak, English, Arabic, Ukrainian.
