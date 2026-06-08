# 🍑💗🧸 Peaches & Pelucha

A private little app for the two of you: a **Phase 10 scoreboard** that tracks
phases, scores and who's winning long-term, plus a **relationship currency**
("hearts" 💗) you can grant, gift, **bet** with, and **cash out** for custom
rewards. No passwords — you just tap who you are.

It installs to your home screens like a real app (it's a PWA) and stays in sync
between both phones through a free Supabase database.

---

## ✨ Try it right now (no setup)

Open `index.html` with `?demo=1` on the end of the URL (e.g.
`https://your-site.netlify.app/?demo=1`). That runs a throwaway in-memory demo
with sample data so you can poke around every screen. Nothing is saved.

For the real, synced app, do the 5-minute setup below.

---

## 🛠️ Setup (do this once, ~5 minutes)

### 1. Make a free Supabase project
1. Go to <https://supabase.com> → sign up (free).
2. Click **New project**. Give it any name, pick a region near you, set a
   database password (you won't need it again), and wait ~2 min for it to spin up.

### 2. Create the tables
1. In your project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file **`schema.sql`** from this folder, copy *everything*, paste it
   into the editor, and click **Run**. You should see "Success".
   - This also seeds two players (**Peaches 🍑** and **Pelucha 🧸**), some earn
     buttons, and a starter reward shop. You can rename/edit all of it in-app.

### 3. Grab your two connection values
1. In Supabase go to **Project Settings → API**.
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`).
3. Copy the **anon public** key (a long string starting with `eyJ...`).

> These two values are safe to use in a client app. The whole point here is a
> private 2-person app with no logins, so the database is intentionally open to
> anyone who has these values — just don't post your URL/key publicly.

### 4. Host on GitHub Pages with auto-deploy
This repo ships a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
publishes to GitHub Pages on every push. The Supabase key is **not** in the repo
(`config.js` is blank) — the workflow injects it from repo **Secrets** at deploy
time, so the published site still connects automatically with no setup screen.

1. **Create a public repo.** On <https://github.com> → **New repository**, name it
   `peaches-pelucha`, **Public**, empty, create.
   *(Public is required for free GitHub Pages. The key isn't in the code or
   history, so the repo source is safe — see the note below about the live page.)*
2. **Add two secrets.** Repo → **Settings → Secrets and variables → Actions →
   New repository secret**, add:
   - `SUPABASE_URL` = `https://ddaidwngxdbvfbchfixn.supabase.co`
   - `SUPABASE_ANON_KEY` = your `sb_publishable_…` key
3. **Turn on Pages via Actions.** Repo → **Settings → Pages → Build and
   deployment → Source = GitHub Actions**.
4. **Push:**
   ```bash
   git remote add origin https://github.com/<your-username>/peaches-pelucha.git
   git push -u origin main
   ```
   The **Actions** tab runs the deploy; when it's green your site is live at
   `https://<your-username>.github.io/peaches-pelucha/`.
5. **From now on, every `git push` auto-deploys.** 🎉

> 🔒 The repo *source/history* never contains the key. But this is a no-backend
> app, so the **published page** does include the key (that's how it talks to
> Supabase with no login) — same as any client-only deploy. The Pages URL is
> unguessable; just don't post it publicly. To rotate the key later, change it in
> Supabase + the `SUPABASE_ANON_KEY` secret and push.

> Prefer no GitHub? Drag this folder onto <https://app.netlify.com/drop> — but
> first paste your values into `config.js` (and don't commit that).

### 5. First open — it just connects
1. Open your live URL on each phone. It connects automatically (no setup screen).
2. Tap who you are. Done! (To switch the database later: **More → Change
   Supabase connection**.)

### 6. Install to the home screen (both phones)
- **iPhone (Safari):** Share button → **Add to Home Screen**.
- **Android (Chrome):** ⋮ menu → **Add to Home screen / Install app**.

Now it opens full-screen like a normal app, and any change one of you makes
shows up on the other's phone within a second.

---

## 🎮 How it works

### Score tab 🏆
- Start a game, then **Add round** after each hand: enter the points left in each
  hand (lower is better) and tick **Phase done** if that player completed their
  current phase.
- The app tracks each player's **current phase** (the dots 1–10), **running
  score**, who's **leading** (👑), and **lifetime wins**.
- **Undo** removes the last round. **Finish game** crowns a winner (suggested:
  furthest phase, then lowest score) and can auto-grant the "Win a game" hearts.

### Wallet tab 💗
- See both balances. **Grant hearts** for anything (tap a preset like "Cooked
  dinner" or enter a custom amount + reason). **Gift** sends some of your own
  hearts to your partner.

### Bets tab 🎲
- Make a wager ("Loser does the dishes"), set a stake, then **settle** it by
  tapping who won. Hearts move only when you settle.

### Shop tab 🎁
- Cash your hearts out for rewards. Tap **Edit** to add your own.

### More tab ⚙️
- Edit players (name/emoji/colour), customise the **earn buttons** and **reward
  shop**, view full history, switch player, or change the connection.

---

## 📁 What's in here
| File | What it is |
|------|------------|
| `index.html` | App entry / shell |
| `app.js` | The whole app (Preact, loaded from a CDN — no build needed) |
| `styles.css` | The peachy theme |
| `config.js` | Blank in the repo; filled by the deploy workflow from Secrets |
| `.github/workflows/deploy.yml` | Auto-deploy to GitHub Pages on push |
| `schema.sql` | Run this once in Supabase to create the tables |
| `migrations/001_matches.sql` | Adds the live-game table to an existing DB |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline shell |
| `demo-client.js` | In-memory backend for `?demo=1` only |
| `tools/make_icons.py` | Regenerates the app icons (optional) |

### A note on the key
The repo and its history never contain the Supabase key — `config.js` is blank,
and the GitHub Actions workflow injects the key from the `SUPABASE_URL` /
`SUPABASE_ANON_KEY` repo Secrets at deploy time. The **published page** still
contains the key (a no-login client app must, to reach Supabase), so keep the URL
private and don't post it. To rotate: update Supabase + the secret, then push.

Made with 💗 for Peaches & Pelucha.
