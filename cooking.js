import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* 🍳 Cooking — the three committed dinner nights (Sun = Peaches, Mon = Pelucha,
   Tue = together) and the farmers-market shopping list. Their market days are
   Sat / Mon / Wed, so every item carries a pickup day and the card always knows
   which market is next. Ingredients added under a meal land on the list too. */

const NIGHTS = [
  { key: "sun", label: "Sunday" },
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
];
const MARKETS = [
  { key: "sat", label: "Sat", dow: 6 },
  { key: "mon", label: "Mon", dow: 1 },
  { key: "wed", label: "Wed", dow: 3 },
];
// dinner night → the market you'd naturally buy it at (tap to change)
const DEFAULT_MARKET = { sun: "sat", mon: "mon", tue: "mon" };

const nextMarket = () => {
  const today = new Date().getDay();
  let best = null;
  for (const m of MARKETS) {
    const delta = (m.dow - today + 7) % 7;
    if (!best || delta < best.delta) best = { ...m, delta };
  }
  return best;
};

export function CookingCard({ client, me, players, flash }) {
  const [meals, setMeals] = useState(null);
  const [items, setItems] = useState(null);
  const [editNight, setEditNight] = useState(null);   // night whose dish is being typed
  const [ingNight, setIngNight] = useState(null);     // night whose ingredient input is open
  const [buyMarket, setBuyMarket] = useState(nextMarket().key);
  const draft = useRef(null);

  const load = useCallback(async () => {
    const [{ data: ms }, { data: si }] = await Promise.all([
      client.from("meals").select("*"),
      client.from("shopping_items").select("*").order("created_at"),
    ]);
    let rows = ms || [];
    // first open on a fresh couple: create the three slots from the players
    if (rows.length < NIGHTS.length && players.length >= 2) {
      const have = new Set(rows.map((r) => r.night));
      const missing = NIGHTS.filter((n) => !have.has(n.key));
      if (missing.length) {
        const cookFor = { sun: players[0], mon: players[1] };
        const ins = missing.map((n) => ({
          night: n.key,
          cook_name: n.key === "tue" ? "together" : (cookFor[n.key] || {}).name || "",
          cook_emoji: n.key === "tue" ? players.map((p) => p.emoji).join("") : (cookFor[n.key] || {}).emoji || "",
        }));
        const { data: added } = await client.from("meals").insert(ins).select();
        if (added) rows = [...rows, ...added]; else { const re = await client.from("meals").select("*"); rows = re.data || rows; }
      }
    }
    setMeals(rows);
    setItems(si || []);
  }, [client, players]);

  useEffect(() => {
    load();
    let ch = null;
    try {
      ch = client.channel("pp-cooking")
        .on("postgres_changes", { event: "*", schema: "public", table: "meals" }, () => load())
        .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, () => load())
        .subscribe();
    } catch {}
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => { document.removeEventListener("visibilitychange", wake); try { ch && client.removeChannel(ch); } catch {} };
  }, [client, load]);

  const mealOf = (night) => (meals || []).find((m) => m.night === night) || null;

  const saveDish = async (night, title) => {
    const m = mealOf(night);
    if (!m || m.title === title) { setEditNight(null); return; }
    // a changed dish goes back to "not locked in" until someone confirms it
    setMeals((cur) => cur.map((x) => (x.night === night ? { ...x, title, confirmed: false } : x)));
    setEditNight(null);
    await client.from("meals").update({ title, confirmed: false, updated_at: new Date().toISOString() }).eq("id", m.id);
  };
  const lockMeal = async (night) => {
    const m = mealOf(night);
    if (!m || !m.title) return;
    setMeals((cur) => cur.map((x) => (x.night === night ? { ...x, confirmed: true } : x)));
    try { navigator.vibrate && navigator.vibrate(25); } catch {}
    await client.from("meals").update({ confirmed: true, updated_at: new Date().toISOString() }).eq("id", m.id);
  };

  const addItem = async (label, market, mealNight) => {
    const t = (label || "").trim();
    if (!t) return;
    const row = { label: t, market: market || null, meal_night: mealNight || null, created_by: me.id };
    const { data } = await client.from("shopping_items").insert(row).select().single();
    if (data) setItems((cur) => [...(cur || []), data]);
  };
  const toggleItem = async (it) => {
    setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, done: !it.done } : x)));
    await client.from("shopping_items").update({ done: !it.done }).eq("id", it.id);
  };
  const cycleMarket = async (it) => {
    const order = ["sat", "mon", "wed", null];
    const next = order[(order.indexOf(it.market) + 1) % order.length];
    setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, market: next } : x)));
    await client.from("shopping_items").update({ market: next }).eq("id", it.id);
  };
  const delItem = async (it) => {
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    await client.from("shopping_items").delete().eq("id", it.id);
  };
  const clearBought = async () => {
    setItems((cur) => cur.filter((x) => !x.done));
    await client.from("shopping_items").delete().eq("done", true);
  };

  const nm = nextMarket();
  const openCount = (mk) => (items || []).filter((i) => i.market === mk && !i.done).length;
  const doneCount = (items || []).filter((i) => i.done).length;

  const ingChips = (night) => (items || []).filter((i) => i.meal_night === night);

  // one night = one carousel card. Three states: EMPTY (dashed invitation),
  // DRAFT (dish typed but not confirmed), LOCKED (dinner picked ✓ — the card
  // fills in warm). Editing a locked dish sends it back to draft.
  const mealCard = (n) => {
    const m = mealOf(n.key);
    const dish = (m && m.title) || "";
    const locked = !!(m && m.confirmed && dish);
    const chips = ingChips(n.key);
    const state = locked ? "locked" : dish ? "draft" : "empty";
    return html`<div class=${`mealcard ${state}`} key=${n.key}>
      <div class="mc-top">
        <span class="mc-emoji">${(m && m.cook_emoji) || ""}</span>
        <div class="mc-night">${n.label}</div>
        <div class="mc-cook">${(m && m.cook_name) || ""}</div>
      </div>
      ${editNight === n.key
        ? html`<input class="mc-input" autofocus value=${dish} maxlength="80" placeholder="what are we making?"
            ref=${(el) => { if (el) draft.current = el; }}
            onKeyDown=${(e) => { if (e.key === "Enter") saveDish(n.key, e.target.value); if (e.key === "Escape") setEditNight(null); }}
            onBlur=${(e) => saveDish(n.key, e.target.value)} />`
        : dish
          ? html`<button class="mc-dish" onClick=${() => setEditNight(n.key)}>${dish}</button>`
          : html`<button class="mc-pick" onClick=${() => setEditNight(n.key)}><span class="mc-plus">＋</span>pick dinner</button>`}
      ${state === "draft" && editNight !== n.key && html`<button class="mc-lock" onClick=${() => lockMeal(n.key)}>Lock it in 🍳</button>`}
      ${locked && html`<div class="mc-locked">✓ dinner picked</div>`}
      ${dish && html`<div class="ingrow mc-ings">
        ${chips.map((it) => html`<span class=${`ingchip ${it.done ? "got" : ""}`} key=${it.id}>
          <span class="ingmk" onClick=${() => cycleMarket(it)}>${it.market ? it.market[0].toUpperCase() : "·"}</span>
          <span onClick=${() => toggleItem(it)}>${it.label}</span>
          <span class="ingx" onClick=${() => delItem(it)}>✕</span>
        </span>`)}
        ${ingNight === n.key
          ? html`<input class="inginput" autofocus placeholder="ingredient…" maxlength="60"
              onKeyDown=${async (e) => {
                if (e.key === "Enter" && e.target.value.trim()) { const v = e.target.value; e.target.value = ""; await addItem(v, DEFAULT_MARKET[n.key], n.key); }
                if (e.key === "Escape") setIngNight(null);
              }}
              onBlur=${async (e) => { if (e.target.value.trim()) await addItem(e.target.value, DEFAULT_MARKET[n.key], n.key); setIngNight(null); }} />`
          : html`<button class="ingadd" onClick=${() => setIngNight(n.key)}>＋</button>`}
      </div>`}
    </div>`;
  };

  return html`<div class="card cookcard">
    <div class="shead"><h2>Cooking <span class="muted-glyph">🍳</span></h2>
      <div class="shead-actions"><span class="mkpill">🧺 ${nm.delta === 0 ? "market today" : `next: ${nm.label}`}${openCount(nm.key) ? ` · ${openCount(nm.key)}` : ""}</span></div>
    </div>

    ${meals === null ? html`<div class="empty"><span class="big">🍳</span>Loading…</div>` : html`
      <div class="mealcarousel" data-noswipe>${NIGHTS.map(mealCard)}</div>

      <div class="buyhead"><span class="buytitle">Shopping list <span class="muted-glyph">🧺</span></span></div>
      <div class="buybar">
        <input placeholder="add to the list…" maxlength="60"
          onKeyDown=${async (e) => { if (e.key === "Enter" && e.target.value.trim()) { const v = e.target.value; e.target.value = ""; await addItem(v, buyMarket, null); } }} />
        <div class="mkseg">
          ${MARKETS.map((mk) => html`<button key=${mk.key} class=${buyMarket === mk.key ? "on" : ""} title=${mk.label} onClick=${() => setBuyMarket(mk.key)}>${mk.label[0]}</button>`)}
          <button class=${buyMarket === null ? "on" : ""} title="anytime" onClick=${() => setBuyMarket(null)}>∙</button>
        </div>
      </div>

      ${MARKETS.map((mk) => {
        const list = (items || []).filter((i) => i.market === mk.key);
        if (!list.length) return null;
        const open = list.filter((i) => !i.done).length;
        return html`<div class="mkgroup" key=${mk.key}>
          <div class="mkhead"><span>${mk.label === "Sat" ? "Saturday" : mk.label === "Mon" ? "Monday" : "Wednesday"} market ${nm.key === mk.key ? html`<span class="mknext">next 🧺</span>` : ""}</span><span class="mkcount">${open || ""}</span></div>
          ${list.map((it) => html`<div class=${`buyline ${it.done ? "got" : ""}`} key=${it.id}>
            <button class="buychk" onClick=${() => toggleItem(it)}>${it.done ? "✓" : ""}</button>
            <span class="buylabel" onClick=${() => toggleItem(it)}>${it.label}${it.meal_night ? html`<span class="buymeal">${(mealOf(it.meal_night) || {}).cook_emoji || ""} ${NIGHTS.find((n) => n.key === it.meal_night).label.slice(0, 3)}</span>` : ""}</span>
            <button class="buyx" onClick=${() => delItem(it)}>✕</button>
          </div>`)}
        </div>`;
      })}
      ${(() => { const list = (items || []).filter((i) => !i.market); return list.length ? html`<div class="mkgroup">
        <div class="mkhead"><span>anytime</span><span class="mkcount">${list.filter((i) => !i.done).length || ""}</span></div>
        ${list.map((it) => html`<div class=${`buyline ${it.done ? "got" : ""}`} key=${it.id}>
          <button class="buychk" onClick=${() => toggleItem(it)}>${it.done ? "✓" : ""}</button>
          <span class="buylabel" onClick=${() => toggleItem(it)}>${it.label}${it.meal_night ? html`<span class="buymeal">${(mealOf(it.meal_night) || {}).cook_emoji || ""} ${NIGHTS.find((n) => n.key === it.meal_night).label.slice(0, 3)}</span>` : ""}</span>
          <button class="buyx" onClick=${() => delItem(it)}>✕</button>
        </div>`)}
      </div>` : null; })()}

      ${doneCount > 0 && html`<button class="linkbtn block mt" style="width:100%" onClick=${clearBought}>Clear bought · ${doneCount}</button>`}
    `}
  </div>`;
}
