import { h } from "https://esm.sh/preact@10.23.2";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* Daily home-screen content: a rotating scripture, deterministic from the DATE
   so both phones show the same words all day and they change overnight. */

const dayIndex = () => {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
};

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

export function ScriptureCard() {
  const v = dailyVerse();
  return html`<div class="card versecard">
    <blockquote class="verse">
      <p class="verse-text">“${v.text}”</p>
      <div class="eyebrow">${v.ref}</div>
    </blockquote>
  </div>`;
}
