// For Peaches 🍑, from Pelucha 🧸 — her birthday app. A letter, ten poems, four promises.
// Same stack as home: Preact + htm + supabase-js, no build step.
import { h, render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";

const html = htm.bind(h);

const PELUCHA_ID = "b8db6a45-06e8-4bb0-bf67-b716c2179393"; // the giver — gets the redemption pushes
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

// ——— Cam: everything she reads lives in LETTER, PHOTOS[].poem, and COUPONS[].sub ———

const LETTER = `My Peaches,

You took my birthday out of my hands and made it unforgettable — which means you never let me plan yours. So this year you get something better than one surprise: a stack of promises, already yours, waiting on your word.

Pick your dates. I'm there for every one of them.

Being loved by you is the best thing that has ever happened to me. Happy birthday, my love.`;

const PHOTOS = [
  {
    path: "m0056.jpg", thumb: "thumb/m0056.jpg", date: "April 4",
    poem: "April, and already\nyour laugh was my favorite room —\nI kissed your cheek\nand moved in for good.",
  },
  {
    path: "m0276.jpg", thumb: "thumb/m0276.jpg", date: "April 4",
    poem: "Four little frames,\na dollar's worth of forever.\nIn the last one\nI couldn't help myself.",
  },
  {
    path: "u1781744975261-9fzgsm.jpg", thumb: "t1781744975261-9fzgsm.webp", date: "May 16",
    poem: "You walked into the tall grass\nand the sun leaned down\nfor a better look.\nI know the feeling.",
  },
  {
    path: "u1781299267195-tm2ufa.jpg", thumb: "thumb/u1781299267195-tm2ufa.jpg", date: "May 16",
    poem: "The sky spent the whole evening\npainting the water gold —\nand still came in second.",
  },
  {
    path: "u1781316190383-q31kax.jpg", thumb: "thumb/u1781316190383-q31kax.jpg", date: "June 12",
    poem: "Golden hour, they call it,\nas if the light does this\nfor everyone.",
  },
  {
    path: "u1781316204863-6uq3vy.jpg", thumb: "t1781316204863-6uq3vy.webp", date: "June 12",
    poem: "Even this face.\nEspecially this face.\nI love every weather\nyou've ever been.",
  },
  {
    path: "u1782005373821-991u58.jpg", thumb: "t1782005373821-991u58.webp", date: "June 20",
    poem: "You collect sunsets;\nI collect the way you look\nreaching for them.\nWe are both rich.",
  },
  {
    path: "u1783646428795-f3jdvs.jpg", thumb: "t1783646428795-f3jdvs.jpg", date: "July 9",
    poem: "July taught me nothing new.\nI already knew where the light\nin the garden\nwas coming from.",
  },
  {
    path: "u1783621284279-wbm3jq.jpg", thumb: "t1783621284279-wbm3jq.webp", date: "July 9",
    poem: "That gasp —\na room full of balloons\nand still nothing in it\nas bright as you.",
  },
  {
    path: "u1783708582218-48xhhe.jpg", thumb: "t1783708582218-48xhhe.webp", date: "Today", finale: true,
    poem: "And today the hills wore\ntheir softest blue for you,\nthe garden held its breath —\nanother year of you,\nimpossibly, gloriously you.\n\nHappy birthday, my Peaches.",
  },
];

const COUPONS = [
  {
    slug: "manipedi", no: "01", emoji: "💅", kind: "date",
    title: "Mani & Pedi Day",
    sub: "Hands, feet, zero responsibilities — a whole day of being pampered.",
    cta: "Book our day",
  },
  {
    slug: "staycation", no: "02", emoji: "🏝️", kind: "range",
    title: "The Staycation",
    sub: "Days checked in somewhere lovely, checked out of real life.",
    cta: "Claim your days",
  },
  {
    slug: "sewing", no: "03", emoji: "🪡", kind: "instant",
    title: "Sewing & Fashion Design Classes",
    sub: "The clothes in your head, out in the world. Your classes are on me.",
    cta: "Redeem",
  },
  {
    slug: "thrift", no: "04", emoji: "🛍️", kind: "instant",
    title: "$250 Thrift Voucher",
    sub: "A treasure hunt, funded — $250 lands in your account when you redeem.",
    cta: "Redeem",
  },
];

// ——— boot: credentials (injected config in prod; live config for local dev) ———
async function getCreds() {
  const c = window.PP_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_ANON_KEY) return c;
  const t = await (await fetch("https://couplelove.github.io/peaches-pelucha/config.js")).text();
  return new Function(`const window = {}; ${t}; return window.PP_CONFIG;`)();
}

let SB_URL = "";
const renderUrl = (p, w) => `${SB_URL}/storage/v1/render/image/public/memories/${p}?width=${w}&quality=80`;
const pubUrl = (p) => `${SB_URL}/storage/v1/object/public/memories/${p}`;

function notifyPelucha(client, title, body) {
  if (IS_LOCAL) return; // never ping his phone from a dev run
  try {
    client.functions.invoke("notify-turn", { body: { player_id: PELUCHA_ID, title, body } }).catch(() => {});
  } catch {}
}

// ——— confetti (canvas, her peach + his purple + gold) ———
const CONF_COLORS = ["#ff7a91", "#ffb4c8", "#9b6bff", "#c15f3c", "#ffd166", "#fffdfb"];
let confCanvas = null, confParts = [], confRaf = 0;
function confetti(n = 140) {
  if (!confCanvas) {
    confCanvas = document.createElement("canvas");
    confCanvas.className = "confetti";
    document.body.appendChild(confCanvas);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  confCanvas.width = innerWidth * dpr;
  confCanvas.height = innerHeight * dpr;
  const W = confCanvas.width, H = confCanvas.height;
  for (let i = 0; i < n; i++) {
    confParts.push({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.35 + (Math.random() - 0.5) * H * 0.2,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (-6 - Math.random() * 10) * dpr,
      w: (5 + Math.random() * 6) * dpr,
      h: (8 + Math.random() * 8) * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONF_COLORS[(Math.random() * CONF_COLORS.length) | 0],
      life: 1,
    });
  }
  if (!confRaf) {
    const ctx = confCanvas.getContext("2d");
    const tick = () => {
      ctx.clearRect(0, 0, confCanvas.width, confCanvas.height);
      confParts = confParts.filter((p) => p.life > 0);
      for (const p of confParts) {
        p.vy += 0.35 * (window.devicePixelRatio || 1);
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.vx *= 0.99;
        if (p.y > confCanvas.height * 0.65) p.life -= 0.02;
        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (confParts.length) { confRaf = requestAnimationFrame(tick); }
      else { confRaf = 0; ctx.clearRect(0, 0, confCanvas.width, confCanvas.height); }
    };
    confRaf = requestAnimationFrame(tick);
  }
}

// ——— date helpers ———
const fmtLong = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtShort = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function payloadLine(c, row) {
  const p = row?.payload || {};
  if (c.kind === "date" && p.date) return fmtLong(p.date);
  if (c.kind === "range" && p.start) return `${fmtShort(p.start)} – ${fmtShort(addDays(p.start, p.days - 1))} · ${p.days} days`;
  if (c.slug === "thrift") return "$250, incoming 💸";
  return "yours, whenever you're ready";
}

// ——— sections ———

function Envelope({ onOpen }) {
  const [opening, setOpening] = useState(false);
  const go = () => {
    if (opening) return;
    setOpening(true);
    confetti(180);
    setTimeout(onOpen, 1050);
  };
  return html`
    <div class="gate ${opening ? "opening" : ""}" onClick=${go}>
      <div class="gate-inner">
        <div class="env">
          <div class="env-flap"></div>
          <div class="env-letter"><span>🎂</span></div>
          <div class="env-body"></div>
          <div class="env-seal">🧸</div>
        </div>
        <div class="gate-name">Peaches</div>
        <div class="gate-sub">something for your birthday</div>
        <div class="gate-hint">tap to open</div>
      </div>
    </div>
  `;
}

function Hero() {
  return html`
    <header class="hero">
      <div class="hero-kicker">July 11, 2026</div>
      <h1 class="hero-title">Happy<br />Birthday</h1>
      <div class="hero-sub">for the girl who plans everyone else's magic</div>
    </header>
  `;
}

function Letter() {
  return html`
    <section class="sec">
      <div class="sec-label"><span>I</span> a letter</div>
      <div class="letter">
        <p>${LETTER}</p>
        <div class="letter-sig">— your Pelucha 🧸</div>
      </div>
    </section>
  `;
}

function Page({ ph, i }) {
  // reveal + fallback mutate the node directly — a Preact re-render inside the
  // snap scroller makes Chrome re-snap and yank the carousel mid-swipe
  return html`
    <div class="page ${ph.finale ? "finale" : ""}" style="background-image:url('${renderUrl(ph.thumb, 480)}')">
      <img
        src=${renderUrl(ph.path, 1100)}
        loading=${i < 2 ? "eager" : "lazy"}
        onLoad=${(e) => { e.target.style.opacity = 1; }}
        onError=${(e) => {
          const el = e.target, fb = pubUrl(ph.path);
          if (el.src !== fb) el.src = fb;
        }}
        alt=""
      />
      <div class="page-scrim"></div>
      <div class="page-date">${ph.date}</div>
      <div class="poem">${ph.poem}</div>
    </div>
  `;
}

function Poems() {
  const ref = useRef(null);
  const [idx, setIdx] = useState(0);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // nearest page-center to the viewport center — immune to gaps/padding
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, bestD = Infinity;
    [...el.children].forEach((ch, i) => {
      const d = Math.abs(ch.offsetLeft + ch.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    setIdx(best);
  }, []);
  return html`
    <section class="sec">
      <div class="sec-label"><span>II</span> the season of us</div>
      <div class="carousel" ref=${ref} onScroll=${onScroll}>
        ${PHOTOS.map((ph, i) => html`<${Page} key=${ph.path} ph=${ph} i=${i} />`)}
      </div>
      <div class="dots">
        ${PHOTOS.map((_, i) => html`<span class="dot ${i === idx ? "on" : ""} ${i === PHOTOS.length - 1 ? "cake" : ""}">${i === PHOTOS.length - 1 ? "🎂" : ""}</span>`)}
      </div>
    </section>
  `;
}

function Coupon({ c, row, onRedeem }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const redeemed = row?.status === "redeemed";

  const go = async () => {
    if (busy) return;
    const payload = c.kind === "date" ? { date } : c.kind === "range" ? { start: date, days } : {};
    setBusy(true);
    await onRedeem(c, payload);
    setBusy(false);
  };
  const needsDate = c.kind !== "instant";
  const ready = !needsDate || !!date;

  return html`
    <div class="ticket ${redeemed ? "done" : ""} ${open && !redeemed ? "open" : ""}"
         onClick=${() => { if (!redeemed && !open) setOpen(true); }}>
      <div class="ticket-stub">
        <div class="ticket-no">№ ${c.no}</div>
        <div class="ticket-emoji">${c.emoji}</div>
      </div>
      <div class="ticket-main">
        <div class="ticket-title">${c.title}</div>
        <div class="ticket-sub">${redeemed ? payloadLine(c, row) : c.sub}</div>
        ${!redeemed && open && html`
          <div class="ticket-form" onClick=${(e) => e.stopPropagation()}>
            ${c.kind === "date" && html`
              <input type="date" min=${todayISO()} value=${date} onInput=${(e) => setDate(e.target.value)} />
            `}
            ${c.kind === "range" && html`
              <input type="date" min=${todayISO()} value=${date} onInput=${(e) => setDate(e.target.value)} />
              <div class="seg">
                <button class=${days === 2 ? "on" : ""} onClick=${() => setDays(2)}>2 days</button>
                <button class=${days === 3 ? "on" : ""} onClick=${() => setDays(3)}>3 days</button>
              </div>
              ${date && html`<div class="range-echo">${fmtShort(date)} – ${fmtShort(addDays(date, days - 1))}</div>`}
            `}
            <button class="redeem" disabled=${!ready || busy} onClick=${go}>
              ${busy ? "…" : c.cta} 💗
            </button>
          </div>
        `}
      </div>
      ${redeemed && html`<div class="stamp">yours ✓</div>`}
    </div>
  `;
}

function Gifts({ client }) {
  // rows + realtime live HERE so coupon updates never re-render the rest of the page
  const [rows, setRows] = useState({});
  useEffect(() => {
    let ch;
    (async () => {
      const { data } = await client.from("bday_coupons").select("*");
      if (data) setRows(Object.fromEntries(data.map((r) => [r.slug, r])));
      ch = client.channel("bday")
        .on("postgres_changes", { event: "*", schema: "public", table: "bday_coupons" },
          (p) => { if (p.new?.slug) setRows((r) => ({ ...r, [p.new.slug]: p.new })); })
        .subscribe();
    })();
    return () => { try { ch?.unsubscribe(); } catch {} };
  }, [client]);

  const onRedeem = async (c, payload) => {
    const now = new Date().toISOString();
    const { data, error } = await client
      .from("bday_coupons")
      .update({ status: "redeemed", payload, redeemed_at: now })
      .eq("slug", c.slug)
      .select()
      .single();
    if (error || !data) return;
    setRows((r) => ({ ...r, [c.slug]: data }));
    confetti(120);
    const detail =
      c.kind === "date" ? `${c.emoji} ${c.title} — ${fmtLong(payload.date)}`
      : c.kind === "range" ? `${c.emoji} ${c.title} — ${fmtShort(payload.start)} to ${fmtShort(addDays(payload.start, payload.days - 1))}`
      : c.slug === "thrift" ? `${c.emoji} ${c.title} — time to send it 💸`
      : `${c.emoji} ${c.title}`;
    notifyPelucha(client, "🍑 Peaches redeemed a birthday gift!", detail);
  };
  return html`
    <section class="sec">
      <div class="sec-label"><span>III</span> your gifts</div>
      <div class="tickets">
        ${COUPONS.map((c) => html`<${Coupon} key=${c.slug} c=${c} row=${rows[c.slug]} onRedeem=${onRedeem} />`)}
      </div>
    </section>
  `;
}

function App() {
  const [client, setClient] = useState(null);
  const [opened, setOpened] = useState(() => localStorage.getItem("pb.opened") === "1");

  useEffect(() => {
    (async () => {
      const creds = await getCreds();
      SB_URL = creds.SUPABASE_URL;
      const c = createClient(creds.SUPABASE_URL, creds.SUPABASE_ANON_KEY);
      window.__pb = c;
      setClient(c);
    })();
  }, []);

  const open = () => {
    localStorage.setItem("pb.opened", "1");
    setOpened(true);
  };

  if (!opened) return html`<${Envelope} onOpen=${open} />`;
  return html`
    <div class="bday">
      <${Hero} />
      <${Letter} />
      <${Poems} />
      ${client && html`<${Gifts} client=${client} />`}
      <footer class="foot">
        <div class="foot-heart">🧸 💗 🍑</div>
        <div>made by your Pelucha, with all of his heart</div>
      </footer>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById("app"));
