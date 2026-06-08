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

### 4. Put the app online (PRIVATE repo)
The Supabase key is baked into `config.js` so the app connects automatically and
nobody has to type anything. Because the key is in the code, the repo must be
**private** — and you deploy through a host that serves private repos for free.

1. On <https://github.com> click **New repository**, name it `peaches-pelucha`,
   set it to **Private**, leave it empty, create it.
2. From this folder:
   ```bash
   git remote add origin https://github.com/<your-username>/peaches-pelucha.git
   git push -u origin main
   ```
3. Connect a free host to that repo:
   - **Cloudflare Pages** (<https://pages.cloudflare.com>) or **Vercel**
     (<https://vercel.com>) → "Import" your private repo. No build command,
     output/root is the repo itself. It gives you a live URL.
   - (Netlify works too. **GitHub Pages' free tier needs a *public* repo**, so
     don't use it while the key is in `config.js`.)

> Want it dead simple with no GitHub at all? Drag this folder onto
> <https://app.netlify.com/drop> — instant URL, key already included.

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
| `config.js` | Your Supabase URL + key (so it auto-connects) — keep the repo private |
| `schema.sql` | Run this once in Supabase to create the tables |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install + offline shell |
| `demo-client.js` | In-memory backend for `?demo=1` only |
| `tools/make_icons.py` | Regenerates the app icons (optional) |

### A note on the key
The Supabase URL + key live in `config.js` so both phones connect automatically.
That key can read/write your database, so **keep the GitHub repo private** and
deploy via Cloudflare Pages / Vercel / Netlify (which serve private repos). Don't
push this to a public repo or free GitHub Pages with the key filled in. If you'd
rather not store the key at all, blank out the two values in `config.js` and the
app will ask for them once per phone instead.

Made with 💗 for Peaches & Pelucha.
