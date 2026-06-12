import { h } from "https://esm.sh/preact@10.23.2";
import { useState, useEffect, useCallback, useRef } from "https://esm.sh/preact@10.23.2/hooks";
import htm from "https://esm.sh/htm@3.1.1";

const html = htm.bind(h);

/* Date Night Roulette 🎰 — spins a pick from the couple's shared idea pool.
   The result is written to `date_spins`, so both phones land on the same plan
   (the partner's phone gets it live via realtime). Ideas are managed inline. */
export function DateRoulette({ client, me, players, flash, onPlan }) {
  const [ideas, setIdeas] = useState(null);    // null = loading
  const [spin, setSpin] = useState(null);      // latest spin row = tonight's pick
  const [filter, setFilter] = useState("any");
  const [reel, setReel] = useState(null);      // label cycling during a spin
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(false); // triggers the landing pop
  const [manage, setManage] = useState(false);
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("");
  const [cat, setCat] = useState("food");
  const timers = useRef([]);
  const lastSeen = useRef(null);

  const pinfo = (id) => players.find((p) => p.id === id) || { name: "?", emoji: "❔" };

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      client.from("date_ideas").select("*").order("created_at"),
      client.from("date_spins").select("*").order("created_at", { ascending: false }).limit(1),
    ]);
    if (!a.error) setIdeas(a.data || []);
    if (!b.error) setSpin((b.data || [])[0] || null);
  }, [client]);

  useEffect(() => {
    load();
    const ch = client.channel("pp-dates")
      .on("postgres_changes", { event: "*", schema: "public", table: "date_ideas" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "date_spins" }, () => load())
      .subscribe();
    const wake = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      try { client.removeChannel(ch); } catch {}
      document.removeEventListener("visibilitychange", wake);
      timers.current.forEach(clearTimeout);
    };
  }, [client, load]);

  // pop when a new pick arrives (incl. from the partner's phone)
  useEffect(() => {
    if (spin && lastSeen.current && spin.id !== lastSeen.current) { setLanded(true); setTimeout(() => setLanded(false), 600); }
    if (spin) lastSeen.current = spin.id;
  }, [spin?.id]);

  const pool = (ideas || []).filter((i) => i.active && (filter === "any" || i.category === filter));

  const doSpin = () => {
    if (spinning || pool.length === 0) return;
    setSpinning(true);
    // avoid landing on the same pick twice in a row when there's a choice
    let options = pool;
    if (spin && pool.length > 1) options = pool.filter((i) => i.label !== spin.label);
    const target = options[Math.floor(Math.random() * options.length)];
    const seq = [...pool].sort(() => Math.random() - 0.5);
    let step = 0;
    const tick = (delay) => {
      const t = setTimeout(async () => {
        if (delay < 250) {
          const c = seq[step % seq.length]; step += 1;
          setReel(`${c.emoji} ${c.label}`);
          tick(delay * 1.25);
        } else {
          setReel(null);
          setSpinning(false);
          setLanded(true);
          setTimeout(() => setLanded(false), 600);
          try { navigator.vibrate && navigator.vibrate(60); } catch {}
          const optimistic = { id: "tmp-" + Date.now(), label: target.label, emoji: target.emoji, category: target.category, spun_by: me.id, created_at: new Date().toISOString() };
          setSpin(optimistic);
          lastSeen.current = optimistic.id;
          const { data } = await client.from("date_spins")
            .insert({ label: target.label, emoji: target.emoji, category: target.category, spun_by: me.id })
            .select().single();
          if (data) { lastSeen.current = data.id; setSpin(data); }
        }
      }, delay);
      timers.current.push(t);
    };
    tick(55);
  };

  const addIdea = async () => {
    if (!label.trim()) return;
    const { error } = await client.from("date_ideas")
      .insert({ label: label.trim(), emoji: emoji.trim() || "✨", category: cat, added_by: me.id });
    if (error) { flash("⚠️ " + error.message); return; }
    setLabel(""); setEmoji("");
    load();
  };
  const removeIdea = async (id) => { await client.from("date_ideas").delete().eq("id", id); load(); };

  return html`<div class="card roulette">
    <div class="row between">
      <h2 style="margin:0">Date night roulette</h2>
      <button class="linkbtn" onClick=${() => setManage(!manage)}>${manage ? "Done" : "Edit"}</button>
    </div>

    <div class="seg mt">
      ${[["any", "🎲 Anything"], ["food", "🍜 Food"], ["activity", "🎟️ Activity"]].map(([k, l]) =>
        html`<button class=${filter === k ? "on" : ""} onClick=${() => setFilter(k)}>${l}</button>`)}
    </div>

    <div class=${`rdisplay ${spinning ? "spinning" : ""} ${landed ? "landed" : ""}`}>
      ${reel != null ? reel
        : spin ? `${spin.emoji} ${spin.label}`
        : ideas === null ? "…" : "Spin for tonight"}
    </div>
    ${spin && !spinning && html`<div class="tiny muted center" style="margin-top:-6px">
      spun by ${pinfo(spin.spun_by).emoji} ${pinfo(spin.spun_by).name}
      ${onPlan && html` · <button class="linkbtn" style="padding:0;font-size:12px"
        onClick=${() => onPlan({ emoji: spin.emoji, title: spin.label })}>add to calendar →</button>`}</div>`}

    <button class="btn block mt" disabled=${spinning || pool.length === 0} onClick=${doSpin}>
      ${pool.length === 0 ? "Add some ideas first" : spinning ? "…" : "Spin"}
    </button>

    ${manage && html`<div class="rmanage">
      <div class="row mt">
        <input style="width:52px;text-align:center" maxlength="4" placeholder="✨" value=${emoji} onInput=${(e) => setEmoji(e.target.value)} />
        <input placeholder="New idea…" value=${label} onInput=${(e) => setLabel(e.target.value)} />
      </div>
      <div class="row mt">
        <div class="seg" style="flex:1">
          <button class=${cat === "food" ? "on" : ""} onClick=${() => setCat("food")}>Food</button>
          <button class=${cat === "activity" ? "on" : ""} onClick=${() => setCat("activity")}>Activity</button>
        </div>
        <button class="btn sm" disabled=${!label.trim()} onClick=${addIdea}>Add</button>
      </div>
      <div class="list mt">
        ${(ideas || []).map((i) => html`<div class="line" key=${i.id}>
          <div class="l"><span class="em">${i.emoji}</span><b>${i.label}</b></div>
          <div class="row"><span class="pill">${i.category === "food" ? "🍜" : "🎟️"}</span>
            <button class="linkbtn danger" onClick=${() => removeIdea(i.id)}>✕</button></div>
        </div>`)}
      </div>
    </div>`}
  </div>`;
}
