// For Peaches 🍑, from Pelucha 🧸 — her birthday app. A letter, ten poems, four promises.
// Same stack as home: Preact + htm + supabase-js, no build step.
import { h, render } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useRef, useCallback } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";

const html = htm.bind(h);

const PELUCHA_ID = "b8db6a45-06e8-4bb0-bf67-b716c2179393"; // the giver — gets the redemption pushes
const PEACHES_ID = "4f9fcad1-63f8-4a98-a5ac-02f0367a0e05"; // the birthday girl / reigning champion
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

// ——— Cam: everything she reads lives in LETTER, ART[].poem, and COUPONS[].sub ———

const LETTER = `My Peaches,

You took my birthday out of my hands and made it unforgettable — which means you never let me plan yours. So this year you get something better than one surprise: a stack of promises, already yours, waiting on your word.

Pick your dates. I'm there for every one of them.

Being loved by you is the best thing that has ever happened to me. Happy birthday, my love.`;

// ——— the gallery: each moment redrawn as a single-line ink drawing.
// One thin ink contour + one misregistered color block. The `ref` on each
// entry is the original photo in the memories bucket it was drawn from.

const LINE = { fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" };
const THIN = { ...LINE, "stroke-width": "1.5" };

// April 4 — he kisses her cheek in the red beanie; she laughs. ref m0056.jpg
function ArtBeanie() {
  return html`
    <svg viewBox="0 0 320 300">
      <path d="M 198 92 C 202 62 240 50 266 64 C 286 74 292 94 288 112 C 258 108 226 112 202 122 C 198 112 196 102 198 92 Z"
        fill="#c15f3c" opacity="0.28" stroke="none" transform="translate(5 -4)" />
      <path ...${LINE} d="M 96 124 C 92 98 112 78 138 82 C 164 86 174 108 170 132 C 166 154 150 170 131 170 C 111 170 99 148 96 124 Z" />
      <path ...${LINE} d="M 110 124 q 8 -7 16 0" />
      <path ...${LINE} d="M 138 124 q 8 -7 16 0" />
      <path ...${LINE} d="M 112 142 Q 130 160 150 140 Q 130 172 112 142 Z" />
      <circle ...${LINE} cx="99" cy="154" r="7" />
      <path ...${LINE} d="M 116 84 C 94 96 86 130 90 168 C 92 192 98 212 106 228" />
      <path ...${LINE} d="M 150 88 C 166 100 170 124 166 146" />
      <path ...${LINE} d="M 198 92 C 202 62 240 50 266 64 C 286 74 292 94 288 112 C 258 108 226 112 202 122 C 198 112 196 102 198 92 Z" />
      <path ...${THIN} d="M 218 70 C 214 82 212 94 212 104" />
      <path ...${THIN} d="M 240 62 C 236 76 234 90 234 102" />
      <path ...${THIN} d="M 260 64 C 258 76 256 88 256 100" />
      <path ...${LINE} d="M 202 122 C 198 134 190 144 180 152" />
      <path ...${LINE} d="M 214 136 q 9 -4 16 2" />
      <path ...${LINE} d="M 180 154 C 188 174 208 184 230 182 C 248 180 260 170 266 154" />
      <path ...${THIN} d="M 196 168 q 6 8 14 10 M 216 178 q 8 4 16 2" />
    </svg>
  `;
}

// April 4 — a hand holds the Williamsburg photobooth strip. ref m0276.jpg
function ArtBooth() {
  return html`
    <svg viewBox="0 0 320 300">
      <rect x="126" y="34" width="84" height="224" rx="6" fill="#f3e7df" opacity="0.7" stroke="none" transform="translate(6 -4)" />
      <rect ...${LINE} x="120" y="32" width="84" height="224" rx="6" />
      <rect ...${THIN} x="130" y="44" width="64" height="44" rx="2" />
      <rect ...${THIN} x="130" y="96" width="64" height="44" rx="2" />
      <rect ...${THIN} x="130" y="148" width="64" height="44" rx="2" />
      <rect ...${THIN} x="130" y="200" width="64" height="44" rx="2" />
      <circle ...${THIN} cx="150" cy="64" r="9" />
      <circle ...${THIN} cx="172" cy="66" r="9" />
      <path ...${THIN} d="M 146 66 q 4 4 8 0 M 168 68 q 4 4 8 0" />
      <circle ...${THIN} cx="152" cy="118" r="9" />
      <circle ...${THIN} cx="172" cy="116" r="9" />
      <path ...${THIN} d="M 166 114 h 12" />
      <circle ...${THIN} cx="150" cy="170" r="9" />
      <circle ...${THIN} cx="171" cy="168" r="9" />
      <path ...${THIN} d="M 146 172 q 4 4 8 0 M 167 170 q 4 4 8 0" />
      <circle ...${THIN} cx="149" cy="224" r="9" />
      <circle ...${THIN} cx="168" cy="220" r="9" />
      <path ...${THIN} d="M 158 222 l 4 2 l -4 2" />
      <path d="M 178 210 C 172 204 176 196 183 198 C 190 196 194 204 188 210 L 183 214 Z" fill="#e8617a" opacity="0.5" stroke="none" />
      <path ...${LINE} d="M 120 196 C 104 192 96 180 98 168 C 100 156 112 154 122 162" />
      <path ...${LINE} d="M 98 168 C 84 178 78 198 84 220 C 88 236 100 248 116 254" />
      <path ...${THIN} d="M 204 216 C 214 212 220 204 222 194" />
    </svg>
  `;
}

// May 16 — the white dress in the tall grass, sun low. ref u1781744975261-9fzgsm.jpg
function ArtMeadow() {
  return html`
    <svg viewBox="0 0 320 300">
      <circle cx="76" cy="62" r="27" fill="#ffd166" opacity="0.55" stroke="none" />
      <circle ...${LINE} cx="70" cy="66" r="24" />
      <circle ...${LINE} cx="200" cy="102" r="13" />
      <path ...${LINE} d="M 210 94 C 222 106 226 128 222 148" />
      <path ...${LINE} d="M 190 116 C 182 134 172 162 160 196 C 182 208 218 208 238 198 C 230 168 220 140 212 118 C 204 112 196 112 190 116 Z" />
      <path ...${LINE} d="M 190 124 C 180 132 174 142 172 152" />
      ${[[48, 252, -6, -40], [70, 258, 4, -34], [96, 250, -8, -44], [122, 260, 6, -36], [148, 254, -4, -46],
         [176, 262, 8, -34], [206, 256, -6, -42], [232, 262, 6, -38], [258, 252, -8, -44], [280, 258, 4, -34],
         [160, 246, -10, -30], [250, 246, 10, -30]].map(([x, y, dx, dy]) =>
        html`<path ...${THIN} d="M ${x} ${y} q ${dx} ${dy / 2} ${dx / 2} ${dy}" />`)}
    </svg>
  `;
}

// May 16 — lakeside promenade, sunset over the mountains. ref u1781299267195-tm2ufa.jpg
function ArtLake() {
  return html`
    <svg viewBox="0 0 320 300">
      <path d="M 142 152 A 22 22 0 0 1 186 152 Z" fill="#ff9e7d" opacity="0.55" stroke="none" transform="translate(4 -3)" />
      <path ...${LINE} d="M 24 152 H 296" />
      <path ...${LINE} d="M 24 152 C 48 124 74 116 98 134 C 112 144 122 150 130 152" />
      <path ...${LINE} d="M 204 152 C 222 132 250 124 272 138 C 284 145 292 150 296 152" />
      <path ...${LINE} d="M 142 152 A 22 22 0 0 1 186 152" />
      <path ...${THIN} d="M 152 166 h 22 M 158 178 h 14 M 154 190 h 9" />
      <circle ...${LINE} cx="96" cy="128" r="11" />
      <path ...${LINE} d="M 88 142 C 84 158 78 182 72 208 C 86 216 108 216 120 210 C 114 184 108 160 104 142 C 98 138 92 138 88 142 Z" />
      <path ...${LINE} d="M 88 150 C 80 158 76 166 74 174 M 104 150 C 110 158 114 166 116 174" />
      <path ...${THIN} d="M 82 224 h 10 M 104 224 h 10" />
      <path ...${THIN} d="M 24 244 C 100 236 220 236 296 244" />
    </svg>
  `;
}

// June 12 — golden hour, cheek to cheek, both grinning. ref u1781316190383-q31kax.jpg
function ArtGolden() {
  return html`
    <svg viewBox="0 0 320 300">
      <circle cx="80" cy="140" r="9" fill="#ff9e7d" opacity="0.45" stroke="none" />
      <circle cx="134" cy="134" r="9" fill="#ff9e7d" opacity="0.45" stroke="none" />
      <circle cx="222" cy="150" r="8" fill="#ff9e7d" opacity="0.35" stroke="none" />
      <path ...${THIN} d="M 28 28 l 20 13 M 44 16 l 14 18 M 20 52 l 23 8" />
      <path ...${LINE} d="M 62 122 C 60 90 90 70 120 76 C 148 82 160 108 154 138 C 149 164 128 182 104 180 C 78 178 64 152 62 122 Z" />
      <path ...${LINE} d="M 84 122 q 8 -7 16 0 M 116 122 q 8 -7 16 0" />
      <path ...${LINE} d="M 86 144 Q 106 164 130 142 Q 108 176 86 144 Z" />
      <path ...${LINE} d="M 86 80 C 64 94 54 126 60 160 C 63 178 72 194 84 204" />
      <path ...${LINE} d="M 154 120 C 160 94 186 80 212 86 C 240 92 254 116 250 144 C 247 168 228 186 204 184 C 182 182 162 164 156 142" />
      <path ...${LINE} d="M 196 124 q 8 -6 16 1" />
      <path ...${THIN} d="M 192 110 q 10 -6 20 -2" />
      <path ...${LINE} d="M 194 150 Q 210 164 228 148" />
      <path ...${LINE} d="M 186 170 C 198 182 218 186 234 178" />
      <path ...${THIN} d="M 196 182 q 6 6 12 7 M 218 188 q 8 2 14 -2" />
    </svg>
  `;
}

// June 12 — the magnificent pout; he stays deadpan. ref u1781316204863-6uq3vy.jpg
function ArtPout() {
  return html`
    <svg viewBox="0 0 320 300">
      <path d="M 74 46 q -6 -16 12 -18 q 4 -14 20 -9 q 16 -7 20 9 q 14 5 7 18 q -14 8 -30 6 q -16 4 -29 -6 Z"
        fill="#cfe7f5" opacity="0.6" stroke="none" transform="translate(4 -3)" />
      <path ...${LINE} d="M 74 46 q -6 -16 12 -18 q 4 -14 20 -9 q 16 -7 20 9 q 14 5 7 18 q -14 8 -30 6 q -16 4 -29 -6 Z" />
      <path ...${THIN} d="M 88 58 l -3 10 M 106 60 l -3 10" />
      <path ...${LINE} d="M 66 148 C 64 118 92 98 120 104 C 146 110 158 134 152 162 C 147 186 127 202 104 200 C 80 198 68 174 66 148 Z" />
      <path ...${LINE} d="M 84 134 L 102 142 M 136 142 L 154 134" />
      <path ...${THIN} d="M 90 150 h 10 M 128 150 h 10" />
      <path ...${LINE} d="M 106 172 q 11 -7 22 0 q -11 9 -22 0 Z" />
      <path ...${LINE} d="M 90 106 C 74 118 66 140 68 164" />
      <path ...${LINE} d="M 192 156 C 188 110 216 84 246 90 C 270 96 282 118 280 142 C 279 162 268 178 252 184" />
      <circle cx="230" cy="136" r="2.4" fill="currentColor" />
      <circle cx="262" cy="136" r="2.4" fill="currentColor" />
      <path ...${THIN} d="M 222 118 q 10 -6 20 -2" />
      <path ...${LINE} d="M 232 160 h 24" />
      <path ...${LINE} d="M 210 172 C 224 188 248 190 266 178" />
      <path ...${THIN} d="M 222 182 q 6 6 13 7 M 244 188 q 8 1 14 -3" />
    </svg>
  `;
}

// June 20 — rooftop, she photographs the sunset. ref u1782005373821-991u58.jpg
function ArtRooftop() {
  return html`
    <svg viewBox="0 0 320 300">
      <circle cx="258" cy="112" r="16" fill="#ff9e7d" opacity="0.55" stroke="none" transform="translate(4 -3)" />
      <circle ...${LINE} cx="258" cy="112" r="14" />
      <path ...${THIN} d="M 258 88 v -10 M 280 96 l 8 -8 M 236 96 l -8 -8" />
      <path ...${LINE} d="M 184 158 h 12 v -10 h 12 v 6 h 14 v -14 h 12 v 10 h 12 v -6 h 14 v 14 h 12 v -8 h 14" />
      <path ...${LINE} d="M 24 178 H 296 M 24 206 H 296" />
      ${[60, 96, 168, 204, 240, 276].map((x) => html`<path ...${THIN} d="M ${x} 178 V 206" />`)}
      <path ...${LINE} d="M 92 100 C 84 78 104 62 124 68 C 144 60 160 76 154 94 C 166 104 160 124 146 128 C 150 144 132 156 118 148 C 100 154 84 142 88 126 C 76 118 80 104 92 100 Z" />
      <path ...${THIN} d="M 102 92 q 10 -8 22 -2 M 112 116 q 12 -6 22 2" />
      <path ...${LINE} d="M 90 168 C 94 152 104 144 120 144 C 136 144 148 152 152 168 L 152 206" />
      <path ...${LINE} d="M 90 206 L 90 170" />
      <path ...${LINE} d="M 148 150 C 160 136 168 124 174 112" />
      <rect ...${LINE} x="168" y="84" width="17" height="28" rx="3" transform="rotate(8 176 98)" />
    </svg>
  `;
}

// July 9 — the garden kiss, gold slip dress, her whole face lit up. ref u1783646428795-f3jdvs.jpg
function ArtGarden() {
  return html`
    <svg viewBox="0 0 320 300">
      <path d="M 286 36 C 274 58 266 82 264 104" stroke="#7fb069" stroke-width="2" fill="none" opacity="0.9" />
      <ellipse cx="276" cy="52" rx="10" ry="5" fill="#7fb069" opacity="0.4" stroke="none" transform="rotate(-36 276 52)" />
      <ellipse ...${THIN} cx="290" cy="70" rx="10" ry="5" transform="rotate(30 290 70)" />
      <ellipse ...${THIN} cx="266" cy="86" rx="9" ry="4.5" transform="rotate(-30 266 86)" />
      ${[[186, 84], [208, 76], [230, 78], [248, 90], [260, 108], [264, 128], [178, 100], [172, 118]].map(([x, y]) =>
        html`<circle ...${THIN} cx=${x} cy=${y} r="9" />`)}
      <path ...${LINE} d="M 176 132 C 176 104 202 86 228 92 C 252 98 262 120 256 146 C 251 170 230 186 208 182 C 188 178 176 156 176 132 Z" />
      <path ...${LINE} d="M 200 128 q 8 -7 16 0 M 228 128 q 8 -7 16 0" />
      <circle cx="196" cy="144" r="7" fill="#ff9e7d" opacity="0.45" stroke="none" />
      <circle cx="248" cy="140" r="7" fill="#ff9e7d" opacity="0.45" stroke="none" />
      <path ...${LINE} d="M 200 148 Q 218 168 242 146 Q 220 180 200 148 Z" />
      <path ...${LINE} d="M 60 162 C 48 122 70 88 110 84 C 132 82 150 92 160 108" />
      <path ...${LINE} d="M 128 118 q 9 -5 16 1" />
      <path ...${LINE} d="M 160 112 q 10 4 8 12 q -10 4 -14 -4" />
      <path ...${LINE} d="M 92 160 C 108 178 134 182 156 170" />
      <path ...${THIN} d="M 104 172 q 7 7 15 8 M 128 180 q 9 2 16 -2" />
      <path ...${LINE} d="M 96 178 C 110 194 134 198 152 190" />
      <rect ...${THIN} x="120" y="196" width="9" height="12" rx="2" />
    </svg>
  `;
}

// July 9 — she gasps in a room full of balloons. ref u1783621284279-wbm3jq.jpg
function ArtBalloons() {
  return html`
    <svg viewBox="0 0 320 300">
      <circle cx="200" cy="62" r="25" fill="#ff9e7d" opacity="0.45" stroke="none" transform="translate(5 -3)" />
      <circle ...${LINE} cx="88" cy="70" r="22" />
      <circle ...${LINE} cx="142" cy="50" r="17" />
      <circle ...${LINE} cx="200" cy="62" r="24" />
      <circle ...${LINE} cx="250" cy="86" r="15" />
      <circle ...${LINE} cx="170" cy="102" r="12" />
      <path ...${THIN} d="M 88 92 C 92 130 98 166 106 200" />
      <path ...${THIN} d="M 142 67 C 146 108 150 148 152 182" />
      <path ...${THIN} d="M 200 86 C 196 124 190 158 180 188" />
      <path ...${THIN} d="M 250 101 C 244 136 234 168 220 196" />
      <path ...${THIN} d="M 170 114 C 170 140 168 162 164 180" />
      <circle ...${LINE} cx="160" cy="176" r="15" />
      ${[[148, 164], [158, 158], [170, 160], [176, 168]].map(([x, y]) => html`<circle ...${THIN} cx=${x} cy=${y} r="5" />`)}
      <path ...${THIN} d="M 150 172 q 3 -4 7 -1 M 165 171 q 4 -3 7 1" />
      <ellipse ...${LINE} cx="160" cy="184" rx="3.6" ry="5" />
      <path ...${LINE} d="M 146 196 C 146 210 174 210 174 196" />
      <path ...${LINE} d="M 152 200 q 8 -8 16 0 q -8 8 -16 0 Z" />
      <path ...${LINE} d="M 146 198 C 138 204 134 212 138 220 M 174 198 C 182 204 186 212 182 220" />
      <path ...${LINE} d="M 148 212 l -3 30 M 172 212 l 3 30" />
      <path ...${THIN} d="M 138 248 h 12 M 170 248 h 12" />
    </svg>
  `;
}

// July 10 — the yellow dress on the stone wall, hills gone soft. ref u1783708582218-48xhhe.webp
function ArtWall() {
  return html`
    <svg viewBox="0 0 320 300">
      <ellipse cx="164" cy="204" rx="42" ry="60" fill="#ffd166" opacity="0.38" stroke="none" transform="translate(6 -4)" />
      <path ...${THIN} d="M 24 92 C 58 76 96 72 134 80" />
      <path ...${THIN} d="M 236 44 q 14 -10 26 2 q 16 -6 22 8 q 14 2 10 16 q -18 8 -34 2 q -18 6 -28 -8 q -6 -12 4 -20 Z" />
      <path ...${LINE} d="M 40 196 H 128 M 204 196 H 282" />
      <path ...${LINE} d="M 40 232 H 126 M 206 232 H 282" />
      <path ...${THIN} d="M 72 196 V 232 M 100 196 V 232 M 234 196 V 232 M 260 196 V 232" />
      <circle ...${LINE} cx="166" cy="104" r="13" />
      ${[[152, 92], [162, 84], [176, 85], [186, 94], [148, 105], [184, 108]].map(([x, y]) =>
        html`<circle ...${THIN} cx=${x} cy=${y} r="7.5" />`)}
      <path ...${THIN} d="M 160 102 q 4 -4 8 0 M 172 102 q 4 -4 8 0" />
      <path ...${THIN} d="M 162 110 q 4 4 8 0" />
      <path ...${LINE} d="M 162 118 C 160 124 159 130 158 136" />
      <path ...${LINE} d="M 158 136 C 150 152 142 172 138 196 C 132 224 130 252 134 272 C 154 281 178 278 192 268 C 192 242 190 216 186 196 C 182 174 178 154 172 136 C 167 130 162 130 158 136 Z" />
      <path ...${THIN} d="M 152 200 C 150 226 150 250 152 268 M 172 198 C 174 222 176 246 178 264" />
      <path ...${LINE} d="M 172 142 C 184 156 196 174 204 192" />
      <path ...${THIN} d="M 200 194 h 12" />
    </svg>
  `;
}

const ART = [
  {
    Art: ArtBeanie, ref: "m0056.jpg", date: "April 4",
    poem: "April, and already\nyour laugh was my favorite room —\nI kissed your cheek\nand moved in for good.",
  },
  {
    Art: ArtBooth, ref: "m0276.jpg", date: "April 4",
    poem: "Four little frames,\na dollar's worth of forever.\nIn the last one\nI couldn't help myself.",
  },
  {
    Art: ArtMeadow, ref: "u1781744975261-9fzgsm.jpg", date: "May 16",
    poem: "You walked into the tall grass\nand the sun leaned down\nfor a better look.\nI know the feeling.",
  },
  {
    Art: ArtLake, ref: "u1781299267195-tm2ufa.jpg", date: "May 16",
    poem: "The sky spent the whole evening\npainting the water gold —\nand still came in second.",
  },
  {
    Art: ArtGolden, ref: "u1781316190383-q31kax.jpg", date: "June 12",
    poem: "Golden hour, they call it,\nas if the light does this\nfor everyone.",
  },
  {
    Art: ArtPout, ref: "u1781316204863-6uq3vy.jpg", date: "June 12",
    poem: "Even this face.\nEspecially this face.\nI love every weather\nyou've ever been.",
  },
  {
    Art: ArtRooftop, ref: "u1782005373821-991u58.jpg", date: "June 20",
    poem: "You collect sunsets;\nI collect the way you look\nreaching for them.\nWe are both rich.",
  },
  {
    Art: ArtGarden, ref: "u1783646428795-f3jdvs.jpg", date: "July 9",
    poem: "July taught me nothing new.\nI already knew where the light\nin the garden\nwas coming from.",
  },
  {
    Art: ArtBalloons, ref: "u1783621284279-wbm3jq.jpg", date: "July 9",
    poem: "That gasp —\na room full of balloons\nand still nothing in it\nas bright as you.",
  },
  {
    Art: ArtWall, ref: "u1783708582218-48xhhe.jpg", date: "Today", finale: true,
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

// ——— the pop-up storybook: her last year, in watercolor & paper ———

function SceneDefs() {
  return html`
    <defs>
      <filter id="wc" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="6" />
      </filter>
      <filter id="wash" x="-40%" y="-40%" width="180%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="16" />
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
    </defs>
  `;
}

const Wash = ({ cx, cy, rx, ry, fill, o = 0.45 }) =>
  html`<ellipse cx=${cx} cy=${cy} rx=${rx} ry=${ry} fill=${fill} opacity=${o} filter="url(#wash)" />`;

// Peaches Shortcake herself: curly hair, peach beret, shortcake tights.
function Girl({ x = 0, y = 0, s = 1, hair = "short", arms = "down", lean = 0 }) {
  const curl = (cx, cy, r) => html`<circle cx=${cx} cy=${cy} r=${r} fill="#46312a" />`;
  return html`
    <g transform="translate(${x} ${y}) rotate(${lean}) scale(${s})">
      ${curl(-18, -108, 11)} ${curl(0, -116, 12)} ${curl(18, -108, 11)}
      ${curl(-24, -96, 9)} ${curl(24, -96, 9)}
      ${hair !== "short" && html`${curl(-26, -80, 8)} ${curl(26, -80, 8)} ${curl(-28, -66, 8)} ${curl(28, -66, 8)}`}
      ${hair === "long" && html`
        ${curl(-30, -52, 8)} ${curl(30, -52, 8)}
        ${curl(-31, -38, 7)} ${curl(31, -38, 7)}
        ${curl(-30, -25, 7)} ${curl(30, -25, 7)}
      `}
      <rect x="-11" y="-28" width="7" height="27" rx="3.5" fill="#fff1e2" />
      <rect x="4" y="-28" width="7" height="27" rx="3.5" fill="#fff1e2" />
      <rect x="-11" y="-22" width="7" height="4" fill="#ffab8a" />
      <rect x="4" y="-22" width="7" height="4" fill="#ffab8a" />
      <rect x="-11" y="-13" width="7" height="4" fill="#ffab8a" />
      <rect x="4" y="-13" width="7" height="4" fill="#ffab8a" />
      <ellipse cx="-7.5" cy="0" rx="7" ry="4" fill="#8a5a44" />
      <ellipse cx="7.5" cy="0" rx="7" ry="4" fill="#8a5a44" />
      <path d="M -13 -76 L 13 -76 C 20 -55 24 -40 26 -26 C 10 -19 -10 -19 -26 -26 C -24 -40 -20 -55 -13 -76 Z"
        fill="#ff9e7d" stroke="#e07a5f" stroke-width="1.5" />
      <circle cx="-8" cy="-52" r="3" fill="#fff4e6" />
      <circle cx="9" cy="-44" r="3" fill="#fff4e6" />
      <circle cx="-2" cy="-33" r="3" fill="#fff4e6" />
      ${arms === "up" ? html`
        <path d="M -12 -68 C -22 -76 -28 -84 -31 -92" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 22 -76 28 -84 31 -92" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      ` : arms === "reach" ? html`
        <path d="M -12 -68 C -20 -66 -28 -62 -35 -57" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 20 -66 28 -62 35 -57" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      ` : html`
        <path d="M -12 -68 C -18 -60 -21 -52 -22 -46" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
        <path d="M 12 -68 C 18 -60 21 -52 22 -46" stroke="#cf9d78" stroke-width="6" stroke-linecap="round" fill="none" />
      `}
      <circle cx="0" cy="-94" r="23" fill="#cf9d78" />
      ${curl(-14, -111, 8)} ${curl(2, -114, 8)} ${curl(15, -110, 7)}
      <circle cx="-9" cy="-89" r="3.6" fill="#ff9d94" opacity="0.75" />
      <circle cx="9" cy="-89" r="3.6" fill="#ff9d94" opacity="0.75" />
      <circle cx="-7.5" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="7.5" cy="-96" r="2.3" fill="#3a2a24" />
      <path d="M -4 -88 Q 0 -84 4 -88" stroke="#3a2a24" stroke-width="1.6" stroke-linecap="round" fill="none" />
      <path d="M -20 -110 C -17 -123 17 -123 20 -110 C 8 -116 -8 -116 -20 -110 Z"
        fill="#ff8f70" stroke="#e07a5f" stroke-width="1.2" />
      <ellipse cx="15" cy="-121" rx="6" ry="3" fill="#7fb069" transform="rotate(-24 15 -121)" />
    </g>
  `;
}

// Pelucha, as himself: a soft brown teddy boy with his purple bow.
function Bear({ x = 0, y = 0, s = 1 }) {
  return html`
    <g transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="-9" cy="-4" rx="8" ry="9" fill="#a9765b" />
      <ellipse cx="9" cy="-4" rx="8" ry="9" fill="#a9765b" />
      <ellipse cx="0" cy="-38" rx="24" ry="28" fill="#a9765b" />
      <ellipse cx="0" cy="-34" rx="14" ry="17" fill="#c9987b" />
      <path d="M -20 -48 C -28 -50 -34 -53 -39 -57" stroke="#a9765b" stroke-width="9" stroke-linecap="round" fill="none" />
      <path d="M 20 -48 C 28 -50 34 -53 39 -57" stroke="#a9765b" stroke-width="9" stroke-linecap="round" fill="none" />
      <circle cx="-16" cy="-112" r="10" fill="#a9765b" />
      <circle cx="16" cy="-112" r="10" fill="#a9765b" />
      <circle cx="-16" cy="-112" r="5" fill="#c9987b" />
      <circle cx="16" cy="-112" r="5" fill="#c9987b" />
      <circle cx="0" cy="-92" r="24" fill="#a9765b" />
      <ellipse cx="0" cy="-83" rx="11" ry="8.5" fill="#e7c3a4" />
      <circle cx="0" cy="-88" r="3" fill="#4a3529" />
      <path d="M 0 -85 L 0 -81" stroke="#4a3529" stroke-width="1.6" stroke-linecap="round" />
      <path d="M -4 -79 Q 0 -76 4 -79" stroke="#4a3529" stroke-width="1.6" stroke-linecap="round" fill="none" />
      <circle cx="-9" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="9" cy="-96" r="2.3" fill="#3a2a24" />
      <circle cx="-15" cy="-87" r="3.4" fill="#ff9d94" opacity="0.55" />
      <circle cx="15" cy="-87" r="3.4" fill="#ff9d94" opacity="0.55" />
      <path d="M 0 -64 L -12 -70 L -12 -58 Z" fill="#9b6bff" />
      <path d="M 0 -64 L 12 -70 L 12 -58 Z" fill="#9b6bff" />
      <circle cx="0" cy="-64" r="3.4" fill="#8253e6" />
    </g>
  `;
}

const Star = ({ x, y, s = 1, fill = "#ffd166" }) =>
  html`<path transform="translate(${x} ${y}) scale(${s})" fill=${fill}
    d="M 0 -7 L 1.8 -1.8 L 7 0 L 1.8 1.8 L 0 7 L -1.8 1.8 L -7 0 L -1.8 -1.8 Z" />`;

const Heart = ({ x, y, s = 1, fill = "#ff8fa3", o = 1 }) =>
  html`<path transform="translate(${x} ${y}) scale(${s})" fill=${fill} opacity=${o}
    d="M 0 4 C -6 -2 -8 -6 -4.5 -8 C -2 -9.5 0 -7.5 0 -6 C 0 -7.5 2 -9.5 4.5 -8 C 8 -6 6 -2 0 4 Z" />`;

function SceneCover() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1"><${Wash} cx="160" cy="130" rx="120" ry="90" fill="#ffd9cf" o="0.55" /></g>
      <g class="pop p2">
        <circle cx="160" cy="130" r="56" fill="#ff9e7d" filter="url(#wc)" />
        <path d="M 160 80 C 152 100 152 160 160 184" stroke="#e07a5f" stroke-width="2" fill="none" opacity="0.5" />
        <ellipse cx="176" cy="72" rx="13" ry="6" fill="#7fb069" transform="rotate(-28 176 72)" />
        <path d="M 160 80 Q 158 70 150 66" stroke="#8a5a44" stroke-width="3" stroke-linecap="round" fill="none" />
        <circle cx="141" cy="128" r="6" fill="#ff9d94" opacity="0.8" />
        <circle cx="179" cy="128" r="6" fill="#ff9d94" opacity="0.8" />
        <circle cx="146" cy="118" r="3.4" fill="#3a2a24" />
        <circle cx="174" cy="118" r="3.4" fill="#3a2a24" />
        <path d="M 152 132 Q 160 140 168 132" stroke="#3a2a24" stroke-width="2.4" stroke-linecap="round" fill="none" />
      </g>
      <g class="pop p3">
        <${Star} x="70" y="70" s="1.2" />
        <${Star} x="250" y="86" s="0.9" fill="#ff8fa3" />
        <${Star} x="238" y="188" s="1.1" />
        <${Star} x="84" y="182" s="0.8" fill="#c4a6ff" />
        <${Heart} x="256" y="140" s="1.2" o="0.8" />
        <${Heart} x="64" y="126" s="1" o="0.7" fill="#c4a6ff" />
      </g>
    </svg>
  `;
}

function SceneHome() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="204" rx="150" ry="26" fill="#cdeac0" o="0.7" />
        <${Wash} cx="160" cy="60" rx="150" ry="42" fill="#cfe7f5" o="0.4" />
      </g>
      <g class="pop p2">
        <circle cx="52" cy="48" r="20" fill="#ffd166" filter="url(#wc)" />
        <g stroke="#ffd166" stroke-width="3" stroke-linecap="round" opacity="0.8">
          <path d="M 52 18 L 52 8" /><path d="M 78 26 L 85 19" /><path d="M 26 26 L 19 19" />
          <path d="M 82 48 L 92 48" />
        </g>
      </g>
      <g class="pop p3">
        <rect x="150" y="118" width="110" height="80" rx="4" fill="#fff4e6" stroke="#d9a173" stroke-width="2" filter="url(#wc)" />
        <path d="M 142 122 L 205 82 L 268 122 Z" fill="#ff9e7d" stroke="#e07a5f" stroke-width="2" filter="url(#wc)" />
        <rect x="232" y="92" width="12" height="24" fill="#b96f4e" />
        <rect x="192" y="150" width="26" height="48" rx="13" fill="#b96f4e" />
        <circle cx="212" cy="176" r="2.4" fill="#ffd166" />
        <rect x="162" y="136" width="20" height="20" rx="2" fill="#cfe7f5" stroke="#d9a173" stroke-width="1.6" />
        <path d="M 172 136 L 172 156 M 162 146 L 182 146" stroke="#d9a173" stroke-width="1.4" />
        <rect x="230" y="136" width="20" height="20" rx="2" fill="#cfe7f5" stroke="#d9a173" stroke-width="1.6" />
        <path d="M 240 136 L 240 156 M 230 146 L 250 146" stroke="#d9a173" stroke-width="1.4" />
        <${Heart} x="205" y="132" s="0.9" />
      </g>
      <g class="pop p4">
        <rect x="96" y="172" width="34" height="26" rx="2" fill="#e8c39e" stroke="#b96f4e" stroke-width="1.6" />
        <path d="M 96 178 L 130 178 M 113 172 L 113 198" stroke="#b96f4e" stroke-width="1.4" />
        <circle cx="106" cy="168" r="5" fill="#ff9e7d" />
        <ellipse cx="122" cy="166" rx="4" ry="2" fill="#7fb069" transform="rotate(-20 122 166)" />
      </g>
      <g class="pop p5">
        <${Girl} x="56" y="202" s="0.72" hair="short" arms="up" />
        <g transform="translate(84 132) rotate(24)">
          <circle cx="0" cy="0" r="6" fill="none" stroke="#d9a827" stroke-width="3.4" />
          <path d="M 5 3 L 16 12 M 12 9 L 9 13 M 16 12 L 13 16" stroke="#d9a827" stroke-width="3.4" stroke-linecap="round" />
        </g>
      </g>
    </svg>
  `;
}

function SceneCareer() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="150" rx="130" ry="70" fill="#ffe8a3" o="0.4" />
        <${Wash} cx="230" cy="70" rx="80" ry="46" fill="#ffd9cf" o="0.45" />
      </g>
      <g class="pop p2">
        <path d="M 30 26 Q 160 6 290 26" stroke="#c9987b" stroke-width="1.6" fill="none" />
        <path d="M 70 22 L 78 40 L 86 23 Z" fill="#ff8fa3" />
        <path d="M 120 19 L 128 37 L 136 20 Z" fill="#cdeac0" />
        <path d="M 170 18 L 178 36 L 186 19 Z" fill="#ffd166" />
        <path d="M 220 20 L 228 38 L 236 21 Z" fill="#c4a6ff" />
      </g>
      <g class="pop p3">
        <g transform="translate(236 130) rotate(14)">
          <rect x="-20" y="-14" width="40" height="28" rx="5" fill="#b96f4e" stroke="#8a5a44" stroke-width="1.6" />
          <path d="M -8 -14 C -8 -22 8 -22 8 -14" stroke="#8a5a44" stroke-width="3" fill="none" />
          <rect x="-3" y="-4" width="6" height="5" rx="1" fill="#ffd166" />
        </g>
        <g transform="translate(66 118) rotate(-12)">
          <rect x="-14" y="-18" width="28" height="36" rx="2" fill="#fffdfb" stroke="#d9a173" stroke-width="1.4" />
          <path d="M -8 -10 L 8 -10 M -8 -3 L 8 -3 M -8 4 L 4 4" stroke="#b7ada1" stroke-width="1.6" />
        </g>
      </g>
      <g class="pop p4">
        <${Star} x="90" y="66" s="1.3" />
        <${Star} x="226" y="56" s="1" fill="#ff8fa3" />
        <${Star} x="270" y="100" s="0.8" fill="#c4a6ff" />
        <${Star} x="52" y="160" s="0.9" />
        <${Star} x="196" y="88" s="0.7" fill="#7fb069" />
      </g>
      <g class="pop p5">
        <ellipse cx="150" cy="212" rx="26" ry="7" fill="#e8dfd4" opacity="0.8" />
        <ellipse cx="128" cy="214" rx="10" ry="5" fill="#f0e8dd" />
        <ellipse cx="172" cy="214" rx="10" ry="5" fill="#f0e8dd" />
        <${Girl} x="150" y="196" s="0.78" hair="mid" arms="up" lean="-6" />
      </g>
    </svg>
  `;
}

function SceneHair() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1"><${Wash} cx="160" cy="120" rx="110" ry="86" fill="#ffd9cf" o="0.5" /></g>
      <g class="pop p2"><${Girl} x="160" y="216" s="0.95" hair="long" arms="down" /></g>
      <g class="pop p3">
        <circle cx="139" cy="118" r="4" fill="#fffdfb" />
        <circle cx="136" cy="115" r="1.6" fill="#ffd166" />
        <circle cx="184" cy="128" r="4" fill="#fffdfb" />
        <circle cx="187" cy="125" r="1.6" fill="#ffd166" />
        <circle cx="132" cy="160" r="3.4" fill="#ff8fa3" />
        <circle cx="190" cy="168" r="3.4" fill="#c4a6ff" />
      </g>
      <g class="pop p4">
        <g transform="translate(74 90) rotate(-14)">
          <ellipse cx="-5" cy="0" rx="7" ry="10" fill="#ff8fa3" opacity="0.85" />
          <ellipse cx="5" cy="0" rx="7" ry="10" fill="#ffb4c8" opacity="0.85" />
          <path d="M 0 -8 L 0 8" stroke="#8a5a44" stroke-width="2" stroke-linecap="round" />
        </g>
        <g transform="translate(248 122) rotate(16)">
          <ellipse cx="-5" cy="0" rx="6" ry="9" fill="#cdeac0" opacity="0.9" />
          <ellipse cx="5" cy="0" rx="6" ry="9" fill="#a8dadc" opacity="0.9" />
          <path d="M 0 -7 L 0 7" stroke="#8a5a44" stroke-width="2" stroke-linecap="round" />
        </g>
        <${Heart} x="234" y="66" s="1.1" o="0.8" />
        <${Heart} x="86" y="150" s="0.9" o="0.7" fill="#c4a6ff" />
      </g>
    </svg>
  `;
}

function SceneLove() {
  return html`
    <svg viewBox="0 0 320 240"><${SceneDefs} />
      <g class="pop p1">
        <${Wash} cx="160" cy="206" rx="140" ry="24" fill="#cdeac0" o="0.6" />
        <path d="M 160 96 C 128 58 92 74 96 104 C 99 128 132 148 160 164 C 188 148 221 128 224 104 C 228 74 192 58 160 96 Z"
          fill="#ff8fa3" opacity="0.3" filter="url(#wash)" />
      </g>
      <g class="pop p2"><${Girl} x="112" y="204" s="0.82" hair="long" arms="reach" /></g>
      <g class="pop p3"><${Bear} x="208" y="204" s="0.82" /></g>
      <g class="pop p4">
        <${Heart} x="160" y="140" s="1.6" />
        <${Heart} x="136" y="112" s="0.9" o="0.8" fill="#c4a6ff" />
        <${Heart} x="186" y="108" s="1" o="0.8" />
        <${Star} x="90" y="80" s="0.9" />
        <${Star} x="238" y="70" s="1" fill="#ff8fa3" />
        <circle cx="70" cy="130" r="3" fill="#ffd166" />
        <circle cx="252" cy="140" r="3" fill="#cdeac0" />
      </g>
    </svg>
  `;
}

const STORY = [
  { Scene: SceneCover, cap: "Once upon a year, there was a girl called Peaches Shortcake…" },
  { Scene: SceneHome, cap: "First, she found a little home that was all her own." },
  { Scene: SceneCareer, cap: "Then she leapt into a brand-new career." },
  { Scene: SceneHair, cap: "Her curls grew long, and wild, and lovely." },
  { Scene: SceneLove, cap: "And then she met a boy… and he loves her so." },
];

function Storybook({ onDone }) {
  const [pg, setPg] = useState(0);
  const lastTap = useRef(0);
  const last = pg === STORY.length - 1;
  const { Scene, cap } = STORY[pg];
  const turn = () => {
    // debounce: a double-tap (or an eager toddler tap) shouldn't skip pages
    const now = Date.now();
    if (now - lastTap.current < 500) return;
    lastTap.current = now;
    if (!last) setPg(pg + 1);
  };
  return html`
    <div class="storybook" onClick=${turn}>
      <div class="story-card" key=${pg}>
        <div class="story-tape"></div>
        <${Scene} />
        <div class="story-cap">${cap}</div>
        ${last && html`
          <button class="story-done" onClick=${(e) => { e.stopPropagation(); onDone(); }}>
            open your birthday 🎂
          </button>
        `}
      </div>
      <div class="story-dots">
        ${STORY.map((_, i) => html`<span class="sdot ${i === pg ? "on" : ""}"></span>`)}
      </div>
      ${!last && html`<div class="story-hint">tap to turn the page</div>`}
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

function Page({ ph }) {
  return html`
    <div class="page ${ph.finale ? "finale" : ""}">
      <div class="page-date">${ph.date}</div>
      <div class="art"><${ph.Art} /></div>
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
        ${ART.map((ph) => html`<${Page} key=${ph.ref} ph=${ph} />`)}
      </div>
      <div class="dots">
        ${ART.map((_, i) => html`<span class="dot ${i === idx ? "on" : ""} ${i === ART.length - 1 ? "cake" : ""}">${i === ART.length - 1 ? "🎂" : ""}</span>`)}
      </div>
    </section>
  `;
}

// ——— the Phase 10 reckoning: live career numbers, computed from games+matches ———
function Record({ client }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    (async () => {
      const [{ data: games }, { data: matches }] = await Promise.all([
        client.from("games").select("winner_id,finished_at").eq("status", "finished").order("finished_at"),
        client.from("matches").select("status,state,created_at").order("created_at"),
      ]);
      if (!games?.length) return;
      const wins = { [PEACHES_ID]: 0, [PELUCHA_ID]: 0 };
      games.forEach((g) => { if (wins[g.winner_id] != null) wins[g.winner_id]++; });
      const lastN = games.slice(-5);
      const last5P = lastN.filter((g) => g.winner_id === PEACHES_ID).length;
      let ptsP = 0, ptsL = 0, bestP = Infinity, bestL = Infinity, live = null;
      (matches || []).forEach((m) => {
        const sc = m.state?.scores || {}, ph = m.state?.phaseOf || {};
        const p = sc[PEACHES_ID], l = sc[PELUCHA_ID];
        if (m.status === "finished" && p != null && l != null) {
          ptsP += p; ptsL += l;
          bestP = Math.min(bestP, p); bestL = Math.min(bestL, l);
        } else if (m.status === "playing" && p != null && l != null) {
          // leader: furthest phase, then fewest points
          const peachLeads = (ph[PEACHES_ID] || 0) !== (ph[PELUCHA_ID] || 0)
            ? (ph[PEACHES_ID] || 0) > (ph[PELUCHA_ID] || 0) : p < l;
          live = { peachLeads };
        }
      });
      setS({ winsP: wins[PEACHES_ID], winsL: wins[PELUCHA_ID], ptsP, ptsL,
             best: Math.min(bestP, bestL), bestIsHers: bestP <= bestL,
             last5P, lastN: lastN.length, live });
    })().catch(() => {});
  }, [client]);
  if (!s) return null;
  return html`
    <section class="sec">
      <div class="sec-label"><span>III</span> for the record</div>
      <div class="record">
        <div class="rec-score">
          <div class="rec-side">
            <div class="rec-crown">👑</div>
            <div class="rec-name">Peaches</div>
            <div class="rec-num her">${s.winsP}</div>
          </div>
          <div class="rec-dash">–</div>
          <div class="rec-side">
            <div class="rec-crown dim">🧸</div>
            <div class="rec-name">Pelucha</div>
            <div class="rec-num him">${s.winsL}</div>
          </div>
        </div>
        <div class="rec-cap">Phase 10, lifetime matches won</div>
        <div class="rec-rows">
          <div class="rec-row"><span>points collected — fewer is better</span><b>${s.ptsP.toLocaleString()} – ${s.ptsL.toLocaleString()}</b></div>
          <div class="rec-row"><span>lowest match score, all time</span><b>${s.best} · ${s.bestIsHers ? "hers" : "his"}</b></div>
          <div class="rec-row"><span>last ${s.lastN} matches</span><b>${s.last5P} – ${s.lastN - s.last5P}</b></div>
        </div>
        ${s.live && html`
          <div class="rec-note">
            ${s.live.peachLeads
              ? "…and she leads the match still in progress. Of course she does."
              : "…he leads the one match still in progress. Let him have this, briefly."}
          </div>
        `}
        <div class="rec-sig">— faithfully recorded by the loser 🧸</div>
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

  // her answer also lands on the Love Bug Calendar, so Pelucha can plan around
  // it in the main app (no email, no forms — it's just there)
  const calendarize = async (c, payload) => {
    const ev = { kind: "fyi", created_by: PEACHES_ID, emoji: c.emoji, title: c.title };
    if (c.kind === "date") {
      ev.starts_on = payload.date;
      ev.notes = "🎁 birthday coupon — she booked this day";
    } else if (c.kind === "range") {
      ev.starts_on = payload.start;
      ev.notes = `🎁 birthday coupon — ${payload.days} days, through ${fmtLong(addDays(payload.start, payload.days - 1))}`;
    } else {
      ev.starts_on = todayISO();
      ev.notes = c.slug === "thrift"
        ? "🎁 birthday coupon redeemed — send her the $250 💸"
        : "🎁 birthday coupon redeemed — book her classes 🪡";
    }
    try { await client.from("events").insert(ev); } catch {}
  };

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
    calendarize(c, payload);
    const detail =
      c.kind === "date" ? `${c.emoji} ${c.title} — ${fmtLong(payload.date)}`
      : c.kind === "range" ? `${c.emoji} ${c.title} — ${fmtShort(payload.start)} to ${fmtShort(addDays(payload.start, payload.days - 1))}`
      : c.slug === "thrift" ? `${c.emoji} ${c.title} — time to send it 💸`
      : `${c.emoji} ${c.title}`;
    notifyPelucha(client, "🍑 Peaches redeemed a birthday gift!", detail);
  };
  return html`
    <section class="sec">
      <div class="sec-label"><span>IV</span> your gifts</div>
      <div class="tickets">
        ${COUPONS.map((c) => html`<${Coupon} key=${c.slug} c=${c} row=${rows[c.slug]} onRedeem=${onRedeem} />`)}
      </div>
    </section>
  `;
}

function App() {
  const [client, setClient] = useState(null);
  // gate → story → main; pb.opened is only set once the story has been read,
  // so quitting mid-story replays the whole intro next time
  const [stage, setStage] = useState(() => (localStorage.getItem("pb.opened") === "1" ? "main" : "gate"));

  useEffect(() => {
    (async () => {
      const creds = await getCreds();
      const c = createClient(creds.SUPABASE_URL, creds.SUPABASE_ANON_KEY);
      window.__pb = c;
      setClient(c);
    })();
  }, []);

  const storyDone = () => {
    localStorage.setItem("pb.opened", "1");
    setStage("main");
    confetti(90);
  };

  if (stage === "gate") return html`<${Envelope} onOpen=${() => setStage("story")} />`;
  // the storybook overlay must live OUTSIDE .bday: its entrance animation makes
  // it a containing block, which would trap our position:fixed inside the page
  return html`
    <div class="bday">
      <${Hero} />
      <${Letter} />
      <${Poems} />
      ${client && html`<${Record} client=${client} />`}
      ${client && html`<${Gifts} client=${client} />`}
      <footer class="foot">
        <div class="foot-heart">🧸 💗 🍑</div>
        <div>made by your Pelucha, with all of his heart</div>
        <button class="foot-replay" onClick=${() => setStage("story")}>read your story again 📖</button>
      </footer>
    </div>
    ${stage === "story" && html`<${Storybook} onDone=${storyDone} />`}
  `;
}

render(html`<${App} />`, document.getElementById("app"));
