import { h } from "https://esm.sh/preact@10.23.2";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* Daily home-screen content: His & Hers Cancer horoscopes ♋ and a rotating
   scripture. Everything is deterministic from the DATE — both phones show the
   same words all day, and they change overnight. No APIs, no internet. */

const dayIndex = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

/* ---- Cancer horoscope generator -------------------------------------------
   Composed from fragment pools with different strides for him/her, so the two
   readings are different but both rotate daily. */
const MOODS = [
  "The moon leans your way today",
  "A soft-shell day — guard it gently",
  "Your intuition runs a degree warmer than usual",
  "Home is the strongest room in the house today",
  "The tide pulls inward; let it",
  "Something nostalgic resurfaces, kindly",
  "Today rewards the quiet move, not the loud one",
  "Your patience is the rare currency today",
  "The crab walks sideways for a reason — so can you",
  "Small comforts carry surprising weight today",
  "An old feeling visits; greet it, don't keep it",
  "You're more persuasive than you realize before noon",
];
const FOCUSES = [
  "say the warm thing out loud instead of just thinking it",
  "finish the small task that's been humming in the background",
  "let the plan stay loose — the best part isn't scheduled",
  "trade one hour of scrolling for one hour of making",
  "ask the question you've been sitting on",
  "feed people; it's your love language and it works",
  "protect the evening — it wants to be slow",
  "take the walk; the answer is somewhere on it",
  "be first to soften — it costs nothing today",
  "trust the gut read over the spreadsheet",
  "leave room for a detour; it's the good kind",
  "tidy one corner and the whole day follows",
];
const CLOSERS = [
  "Lucky hour: just after dinner.",
  "Wear something soft. Trust it.",
  "A 💗 spent today returns double.",
  "The discard pile knows. Watch it.",
  "Tonight favors the bold lay-down.",
  "Someone owes you a back rub. Collect.",
  "Phone down, eyes up — that's the magic window.",
  "Dessert is not optional today.",
  "Your wild card is literal tonight.",
  "Say yes to the second round.",
];

export function cancerDaily(offset) {
  const d = dayIndex() + offset * 7;             // his/hers diverge
  return {
    mood: MOODS[d % MOODS.length],
    focus: FOCUSES[(d * 5 + 3) % FOCUSES.length],
    closer: CLOSERS[(d * 3 + 1) % CLOSERS.length],
  };
}

/* ---- rotating scripture (KJV, short) ---- */
const VERSES = [
  ["And now abideth faith, hope, charity, these three; but the greatest of these is charity.", "1 Corinthians 13:13"],
  ["Two are better than one; because they have a good reward for their labour.", "Ecclesiastes 4:9"],
  ["Many waters cannot quench love, neither can the floods drown it.", "Song of Solomon 8:7"],
  ["A friend loveth at all times.", "Proverbs 17:17"],
  ["We love him, because he first loved us.", "1 John 4:19"],
  ["Whither thou goest, I will go; and where thou lodgest, I will lodge.", "Ruth 1:16"],
  ["And above all these things put on charity, which is the bond of perfectness.", "Colossians 3:14"],
  ["And above all things have fervent charity among yourselves.", "1 Peter 4:8"],
  ["This is the day which the Lord hath made; we will rejoice and be glad in it.", "Psalm 118:24"],
  ["And a threefold cord is not quickly broken.", "Ecclesiastes 4:12"],
  ["Let not mercy and truth forsake thee: bind them about thy neck.", "Proverbs 3:3"],
  ["This is my commandment, That ye love one another, as I have loved you.", "John 15:12"],
  ["Be kindly affectioned one to another with brotherly love.", "Romans 12:10"],
  ["Let all your things be done with charity.", "1 Corinthians 16:14"],
  ["Delight thyself also in the Lord; and he shall give thee the desires of thine heart.", "Psalm 37:4"],
  ["I thank my God upon every remembrance of you.", "Philippians 1:3"],
  ["Charity suffereth long, and is kind; charity envieth not.", "1 Corinthians 13:4"],
  ["Let thy fountain be blessed: and rejoice with the wife of thy youth.", "Proverbs 5:18"],
  ["Set me as a seal upon thine heart.", "Song of Solomon 8:6"],
  ["The Lord watch between me and thee, when we are absent one from another.", "Genesis 31:49"],
];

export function dailyVerse() {
  const [text, ref] = VERSES[dayIndex() % VERSES.length];
  return { text, ref };
}

/* ---- components ---- */
export function HoroscopeCard({ players }) {
  // Pelucha 🧸 · July 10 (him) — Peaches 🍑 · July 11 (her)
  const pelucha = players.find((p) => p.name === "Pelucha") || players[1] || { emoji: "🧸", name: "Pelucha" };
  const peaches = players.find((p) => p.name === "Peaches") || players[0] || { emoji: "🍑", name: "Peaches" };
  const his = cancerDaily(0), hers = cancerDaily(1);
  const Reading = (who, date, r) => html`<div class="horo-half">
    <div class="eyebrow">${who.emoji} ${who.name} · ${date}</div>
    <p class="horo-text">${r.mood} — ${r.focus}. <span class="horo-closer">${r.closer}</span></p>
  </div>`;
  return html`<div class="card">
    <h2>Cancer, today <span class="muted-glyph">♋</span></h2>
    <div class="horo">
      ${Reading(pelucha, "July 10", his)}
      ${Reading(peaches, "July 11", hers)}
    </div>
  </div>`;
}

export function ScriptureCard() {
  const v = dailyVerse();
  return html`<div class="card versecard">
    <blockquote class="verse">
      <p class="verse-text">“${v.text}”</p>
      <div class="eyebrow">${v.ref}</div>
    </blockquote>
  </div>`;
}
