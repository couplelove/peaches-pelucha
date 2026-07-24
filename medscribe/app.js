import { h, render } from 'https://esm.sh/preact@10.23.1';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.23.1/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

/* ------------------------------------------------------------------ *
 * config / keys (stored locally on this device only)
 * ------------------------------------------------------------------ */
const LS = 'medscribe.settings.v1';
const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; }
};
const saveSettings = (s) => localStorage.setItem(LS, JSON.stringify(s));

const CLAUDE_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced (recommended)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most thorough' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest / cheapest' },
];

const SCRIBE_MODELS = [
  { id: 'scribe_v2', label: 'Scribe v2 (recommended)' },
  { id: 'scribe_v1', label: 'Scribe v1' },
];

const fmtTime = (s) => {
  s = Math.floor(s || 0);
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

// Pick a recording container the current browser actually supports.
// Chrome/Firefox → webm/opus; iOS + macOS Safari → mp4/aac. Returns file ext too.
function pickRecordingType() {
  const cands = [
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
    ['audio/mp4', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/ogg;codecs=opus', 'ogg'],
  ];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return { mime: '', ext: 'webm' };
  }
  for (const [mime, ext] of cands) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' }; // let the browser choose its default
}

/* ------------------------------------------------------------------ *
 * ElevenLabs Scribe — speech to text with diarization
 * ------------------------------------------------------------------ */
async function transcribeAudio({ blob, filename, apiKey, model }) {
  const fd = new FormData();
  fd.append('model_id', model || 'scribe_v2');
  fd.append('file', blob, filename || 'audio.webm');
  fd.append('diarize', 'true');
  fd.append('timestamps_granularity', 'word');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: fd,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.detail?.message || JSON.stringify(await res.json()); } catch {}
    throw new Error(`ElevenLabs ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  return { text: data.text || '', words: data.words || [], language: data.language_code };
}

// group the flat word list into speaker turns
function toTurns(words) {
  const turns = [];
  let cur = null;
  for (const w of words) {
    if (w.type && w.type !== 'word' && w.type !== 'spacing') continue;
    const sp = w.speaker_id || 'speaker_0';
    if (!cur || cur.speaker !== sp) {
      cur = { speaker: sp, start: w.start, text: '' };
      turns.push(cur);
    }
    cur.text += (w.text || '');
    cur.end = w.end;
  }
  // tidy whitespace
  return turns.map(t => ({ ...t, text: t.text.replace(/\s+/g, ' ').trim() })).filter(t => t.text);
}

function speakerLabel(id, map) {
  if (!map[id]) map[id] = `Speaker ${Object.keys(map).length + 1}`;
  return map[id];
}

function turnsToPlain(turns) {
  const map = {};
  return turns.map(t => `[${fmtTime(t.start)}] ${speakerLabel(t.speaker, map)}: ${t.text}`).join('\n');
}

/* ------------------------------------------------------------------ *
 * Claude — structure the transcript into a patient-friendly note
 * ------------------------------------------------------------------ */
// Body-chart regions: the enum Claude may choose from, each mapped to a spot on
// the silhouette (x,y in a 100×300 figure) and which view it belongs to. Keeping
// this a fixed vocabulary is what lets us plot free-text findings reliably.
const REGION_MAP = {
  // front — central
  head: { view: 'front', x: 50, y: 20 }, face_jaw: { view: 'front', x: 50, y: 32 },
  neck: { view: 'front', x: 50, y: 46 }, chest: { view: 'front', x: 50, y: 78 },
  abdomen: { view: 'front', x: 50, y: 110 }, pelvis_groin: { view: 'front', x: 50, y: 140 },
  // front — limbs (left/right = patient's side; shown mirrored on the figure)
  left_shoulder: { view: 'front', x: 26, y: 60 }, right_shoulder: { view: 'front', x: 74, y: 60 },
  left_upper_arm: { view: 'front', x: 20, y: 88 }, right_upper_arm: { view: 'front', x: 80, y: 88 },
  left_elbow: { view: 'front', x: 17, y: 112 }, right_elbow: { view: 'front', x: 83, y: 112 },
  left_forearm: { view: 'front', x: 15, y: 134 }, right_forearm: { view: 'front', x: 85, y: 134 },
  left_wrist_hand: { view: 'front', x: 13, y: 158 }, right_wrist_hand: { view: 'front', x: 87, y: 158 },
  left_hip: { view: 'front', x: 36, y: 150 }, right_hip: { view: 'front', x: 64, y: 150 },
  left_thigh: { view: 'front', x: 39, y: 188 }, right_thigh: { view: 'front', x: 61, y: 188 },
  left_knee: { view: 'front', x: 39, y: 222 }, right_knee: { view: 'front', x: 61, y: 222 },
  left_shin: { view: 'front', x: 39, y: 254 }, right_shin: { view: 'front', x: 61, y: 254 },
  left_ankle_foot: { view: 'front', x: 39, y: 288 }, right_ankle_foot: { view: 'front', x: 61, y: 288 },
  // back — central spine
  cervical_spine: { view: 'back', x: 50, y: 46 }, thoracic_spine: { view: 'back', x: 50, y: 88 },
  lumbar_spine: { view: 'back', x: 50, y: 122 }, sacrum: { view: 'back', x: 50, y: 146 },
  // back — other
  left_scapula: { view: 'back', x: 32, y: 78 }, right_scapula: { view: 'back', x: 68, y: 78 },
  left_glute: { view: 'back', x: 38, y: 152 }, right_glute: { view: 'back', x: 62, y: 152 },
  left_hamstring: { view: 'back', x: 39, y: 190 }, right_hamstring: { view: 'back', x: 61, y: 190 },
  left_calf: { view: 'back', x: 39, y: 254 }, right_calf: { view: 'back', x: 61, y: 254 },
};
const REGIONS = Object.keys(REGION_MAP);
const SYMPTOMS = ['pain', 'ache', 'stiffness', 'numbness', 'tingling', 'weakness', 'swelling', 'instability', 'other'];
const prettyRegion = (r) => (r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const SYSTEM_PROMPT = `You are a meticulous clinical documentation assistant for a physiotherapy / musculoskeletal setting. You turn a raw, possibly messy transcript of a clinical appointment into structured, professional documentation.

Hard rules:
- Never invent facts. Use ONLY what is in the transcript. If something was not discussed, leave that field empty — do not guess or pad.
- Do not add new clinical advice, diagnoses, or measurements the clinician did not state. You are documenting what was said, not practising.
- Preserve exact medication names, doses, measurement values, and numbers as spoken. If a value is unclear, append "(verify)".
- Write in professional clinical language for the clinician-facing sections (SOAP, objective measures, history), and plain language for the patient-facing summary.
- For the body chart: only add a point when the transcript describes a symptom in a specific body area. Choose the closest region from the allowed list, the patient's side, the symptom type, and a 0–10 severity if a pain/severity score was mentioned (else omit severity).
- Record your result by calling the record_clinical_notes tool — do not reply with prose.`;

// Forced tool-use gives us guaranteed structured output. (Current Claude models
// no longer accept the assistant-message JSON prefill trick, so we don't use it.)
const NOTES_TOOL = {
  name: 'record_clinical_notes',
  description: 'Record structured clinical documentation extracted from the appointment transcript.',
  input_schema: {
    type: 'object',
    properties: {
      cleaned_transcript: { type: 'string', description: 'Transcript with speaker labels (Clinician / Patient where obvious, otherwise Speaker 1 / 2), filler removed, obvious errors fixed — faithful to meaning. Line breaks between turns.' },
      summary: { type: 'string', description: '2-4 sentence plain-language recap for the patient.' },
      diagnoses: { type: 'array', items: { type: 'string' }, description: 'Diagnoses or clinical impressions the clinician actually named.' },
      soap: {
        type: 'object',
        description: 'SOAP note. Leave any field an empty string if that part was not covered.',
        properties: {
          subjective: { type: 'string', description: "Patient's reported symptoms, history, and concerns in their words / as reported." },
          objective: { type: 'string', description: 'Observable/measurable findings: observation, palpation, ROM, strength, special tests, gait, etc.' },
          assessment: { type: 'string', description: 'Clinical reasoning, working diagnosis, problem list, stage/irritability.' },
          plan: { type: 'string', description: 'Treatment provided, home exercise program, education, referrals, and the plan going forward.' },
        },
        required: ['subjective', 'objective', 'assessment', 'plan'],
      },
      medical_history: {
        type: 'object',
        properties: {
          presenting_complaint: { type: 'string', description: 'The main problem, briefly.' },
          history_of_presenting_complaint: { type: 'string', description: 'Onset, mechanism, duration, behaviour, aggravating/easing factors, 24-hour pattern.' },
          past_medical_history: { type: 'array', items: { type: 'string' } },
          current_medications: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, dosage: { type: 'string' }, instructions: { type: 'string' } }, required: ['name'] } },
          allergies: { type: 'array', items: { type: 'string' } },
          social_history: { type: 'string', description: 'Occupation, activity level, home situation, goals-relevant lifestyle.' },
          red_flags: { type: 'array', items: { type: 'string' }, description: 'Any red-flag symptoms explicitly raised (e.g. saddle anaesthesia, night pain, unexplained weight loss). Empty if none mentioned.' },
        },
        required: ['presenting_complaint', 'history_of_presenting_complaint', 'past_medical_history', 'current_medications', 'allergies', 'social_history', 'red_flags'],
      },
      body_chart: {
        type: 'array',
        description: 'One entry per symptomatic body area described in the transcript.',
        items: {
          type: 'object',
          properties: {
            region: { type: 'string', enum: REGIONS, description: 'Closest matching body region.' },
            view: { type: 'string', enum: ['front', 'back'] },
            symptom: { type: 'string', enum: SYMPTOMS },
            severity: { type: 'number', description: 'Pain/severity 0–10 if stated; omit if not.' },
            notes: { type: 'string', description: 'e.g. radiating, intermittent, on movement.' },
          },
          required: ['region', 'view', 'symptom'],
        },
      },
      objective_measures: {
        type: 'array',
        description: 'Measurable findings actually stated: ROM, strength (e.g. 4/5), special-test results, outcome scores (e.g. NPRS, girth). Empty if none.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'e.g. "Knee flexion ROM", "Quadriceps strength (MMT)", "NPRS pain".' },
            value: { type: 'string' },
            unit: { type: 'string', description: 'e.g. degrees, /5, /10, cm.' },
            side: { type: 'string', enum: ['left', 'right', 'bilateral', 'n/a'] },
            notes: { type: 'string' },
          },
          required: ['name', 'value'],
        },
      },
      goals: {
        type: 'object',
        properties: {
          short_term: { type: 'array', items: { type: 'string' }, description: 'Short-term goals stated or agreed.' },
          long_term: { type: 'array', items: { type: 'string' } },
        },
        required: ['short_term', 'long_term'],
      },
      action_items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string' } }, required: ['text'] } },
      follow_up: { type: 'string', description: 'When/whether to return, as stated. Empty string if none.' },
      questions_for_next_time: { type: 'array', items: { type: 'string' } },
    },
    required: ['cleaned_transcript', 'summary', 'diagnoses', 'soap', 'medical_history', 'body_chart', 'objective_measures', 'goals', 'action_items', 'follow_up', 'questions_for_next_time'],
  },
};

async function analyzeTranscript({ transcript, apiKey, model }) {
  const body = {
    model: model || 'claude-sonnet-5',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [NOTES_TOOL],
    tool_choice: { type: 'tool', name: 'record_clinical_notes' },
    messages: [
      { role: 'user', content: `Here is the appointment transcript:\n\n${transcript}` },
    ],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message; } catch {}
    throw new Error(`Claude ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  const tool = (data.content || []).find(b => b.type === 'tool_use');
  if (!tool || !tool.input) throw new Error('Claude did not return structured notes — please try again.');
  return tool.input;
}

/* ---- ?demo=1 seeds sample clinical data so the full UI can be viewed without a recording ---- */
const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
const DEMO_TURNS = [
  { speaker: 'speaker_0', start: 0, text: "What's brought you in today?" },
  { speaker: 'speaker_1', start: 3, text: "Lower back pain for about three weeks after I lifted a heavy box. It's about 6 out of 10 and shoots down my right leg to the calf, with some tingling in my right foot." },
  { speaker: 'speaker_0', start: 18, text: "Lumbar flexion is reduced to about 40 degrees, straight leg raise is positive on the right at 45 degrees, right calf strength 4 out of 5. Looks like an L5/S1 irritation — let's start gentle mobility work and review in two weeks." },
];
const DEMO_ANALYSIS = {
  cleaned_transcript: "Clinician: What's brought you in today?\nPatient: Lower back pain for three weeks after lifting a heavy box…",
  summary: "You have lower back pain that started three weeks ago after lifting, now with pain radiating into the right leg. Examination points to an irritated nerve in the lower back, which usually settles with gentle exercise. Review in two weeks.",
  diagnoses: ["Lumbar disc irritation with L5/S1 radiculopathy (clinical impression)"],
  soap: {
    subjective: "3-week history of lower back pain following lifting a heavy box at work. 6/10, worse in mornings and with forward flexion. Radiating pain to the right calf with tingling in the right foot. No bladder/bowel changes, night pain, or weight loss.",
    objective: "Lumbar flexion reduced (~40°), extension full but painful. Right SLR reproduces symptoms at 45°. Right calf strength 4/5, neurology otherwise intact.",
    assessment: "Findings consistent with lumbar disc irritation with nerve involvement (L5/S1 radiculopathy). No red flags. Favourable prognosis with conservative management.",
    plan: "Commence gentle lumbar mobility exercises, activity modification (avoid heavy lifting), home exercise program provided, education re: prognosis. Review in 2 weeks.",
  },
  medical_history: {
    presenting_complaint: "Lower back pain radiating to the right leg.",
    history_of_presenting_complaint: "Onset ~3 weeks ago after lifting a heavy box at work. Worse in mornings and on forward bending.",
    past_medical_history: ["Right knee arthroscopy (~5 years ago)"],
    current_medications: [{ name: "Ibuprofen", dosage: "400 mg", instructions: "As needed" }],
    allergies: [],
    social_history: "Works in a warehouse; otherwise active.",
    red_flags: [],
  },
  body_chart: [
    { region: 'lumbar_spine', view: 'back', symptom: 'pain', severity: 6, notes: 'Worse AM & on flexion' },
    { region: 'right_calf', view: 'back', symptom: 'pain', notes: 'Radiating from low back' },
    { region: 'right_ankle_foot', view: 'front', symptom: 'tingling', notes: 'Right foot' },
  ],
  objective_measures: [
    { name: 'Lumbar flexion ROM', value: '40', unit: 'degrees', side: 'n/a', notes: 'reduced' },
    { name: 'Straight leg raise', value: '45', unit: 'degrees', side: 'right', notes: 'reproduces symptoms' },
    { name: 'Calf strength (MMT)', value: '4', unit: '/5', side: 'right' },
  ],
  goals: {
    short_term: ["Reduce right leg pain over the next 2 weeks", "Improve forward bending comfort"],
    long_term: ["Return to full warehouse duties"],
  },
  action_items: [{ text: "Complete daily home exercise program", owner: "patient" }, { text: "Avoid heavy lifting", owner: "patient" }],
  follow_up: "Review in 2 weeks.",
  questions_for_next_time: ["Is imaging needed if symptoms persist?"],
};

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */
function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(DEMO ? false : (!loadSettings().elevenKey || !loadSettings().anthropicKey));

  const [audio, setAudio] = useState(null); // { blob, url, name }
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // microphone / device state
  const [devices, setDevices] = useState([]);      // audioinput MediaDeviceInfo[]
  const [deviceId, setDeviceId] = useState('');    // '' = system default
  const [micState, setMicState] = useState('unknown'); // unknown|prompt|granted|denied|unsupported
  const [level, setLevel] = useState(0);           // live input level 0..1

  const [phase, setPhase] = useState(DEMO ? 'done' : 'idle'); // idle | transcribing | transcribed | analyzing | done
  const [turns, setTurns] = useState(DEMO ? DEMO_TURNS : null);
  const [analysis, setAnalysis] = useState(DEMO ? DEMO_ANALYSIS : null);
  const [tab, setTab] = useState('soap');
  const [error, setError] = useState('');

  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);

  const keysReady = settings.elevenKey && settings.anthropicKey;

  /* ---- device discovery (works on Mac + iOS + Android) ---- */
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const mics = list.filter(d => d.kind === 'audioinput');
      setDevices(mics);
      if (mics.some(m => m.label)) setMicState('granted');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) { setMicState('unsupported'); return; }
    refreshDevices();
    // reflect live permission state where the browser supports it (not Safari)
    navigator.permissions?.query?.({ name: 'microphone' })
      .then(p => { setMicState(p.state); p.onchange = () => setMicState(p.state); })
      .catch(() => {});
    // refresh the list when the user plugs in AirPods / a USB mic mid-session
    const onChange = () => refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  }, [refreshDevices]);

  // Prompt for access so we can show real device names before recording.
  const enableMic = useCallback(async () => {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      setMicState('granted');
      refreshDevices();
    } catch {
      setMicState('denied');
      setError('Microphone access was blocked. Allow it in your browser/site settings, then reload.');
    }
  }, [refreshDevices]);

  /* ---- live input level meter (confirms the device is being heard) ---- */
  const startMeter = useCallback((stream) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      ctx.resume?.();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = ctx;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* metering is best-effort */ }
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close?.(); } catch {}
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  /* ---- recording ---- */
  const startRecording = useCallback(async () => {
    setError('');
    try {
      const audioConstraint = deviceId
        ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      streamRef.current = stream;
      setMicState('granted');
      refreshDevices();       // now that we have permission, labels resolve
      startMeter(stream);

      const { mime, ext } = pickRecordingType();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        stopMeter();
        const type = rec.mimeType || mime || `audio/${ext}`;
        const blob = new Blob(chunksRef.current, { type });
        resetResults();
        setAudio({ blob, url: URL.createObjectURL(blob), name: `recording.${ext}` });
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (e) {
      stopMeter();
      setMicState('denied');
      setError('Could not access the microphone. Allow mic permission in your browser and try again. On phones the page must be served over https.');
    }
  }, [deviceId, refreshDevices, startMeter, stopMeter]);

  const stopRecording = useCallback(() => {
    recRef.current?.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  }, []);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    resetResults();
    setAudio({ blob: f, url: URL.createObjectURL(f), name: f.name });
  };

  const resetResults = () => { setTurns(null); setAnalysis(null); setPhase('idle'); setError(''); };

  /* ---- pipeline ---- */
  const runTranscribe = async () => {
    if (!audio) return;
    setError(''); setPhase('transcribing');
    try {
      const r = await transcribeAudio({
        blob: audio.blob, filename: audio.name,
        apiKey: settings.elevenKey, model: settings.scribeModel,
      });
      const t = toTurns(r.words);
      setTurns(t.length ? t : [{ speaker: 'speaker_0', start: 0, text: r.text }]);
      setPhase('transcribed');
      // auto-continue into analysis
      runAnalyze(t.length ? t : [{ speaker: 'speaker_0', start: 0, text: r.text }]);
    } catch (e) {
      setError(e.message); setPhase('idle');
    }
  };

  const runAnalyze = async (t) => {
    const source = t || turns;
    if (!source) return;
    setError(''); setPhase('analyzing');
    try {
      const a = await analyzeTranscript({
        transcript: turnsToPlain(source),
        apiKey: settings.anthropicKey, model: settings.claudeModel,
      });
      setAnalysis(a); setPhase('done'); setTab('soap');
    } catch (e) {
      setError('Transcription is ready, but analysis failed — ' + e.message);
      setPhase('transcribed');
    }
  };

  const busy = phase === 'transcribing' || phase === 'analyzing';

  /* ---- render ---- */
  return html`
    <div class="wrap">
      <header class="top">
        <div class="brand">
          <h1>Med<span class="dot">Scribe</span></h1>
          <span class="tag">appointment transcription</span>
        </div>
        <button class="iconbtn" title="Settings" onClick=${() => setShowSettings(s => !s)}>⚙</button>
      </header>

      ${showSettings && html`<${Settings} settings=${settings} onSave=${(s) => { setSettings(s); saveSettings(s); if (s.elevenKey && s.anthropicKey) setShowSettings(false); }} />`}

      ${!showSettings && html`
        <div class="notice warn">
          <span>🔒</span>
          <span>Audio goes to <b>ElevenLabs</b> and the transcript to <b>Anthropic</b> for processing. Only record with everyone's consent, and never treat this as your official medical record.</span>
        </div>

        ${!keysReady && !DEMO && html`
          <div class="card"><p class="empty">Add your API keys in settings (⚙) to begin.</p></div>`}

        ${keysReady && html`
          <div class="card">
            <h2>Capture</h2>
            <div class="capture">
              <div class="timer">${fmtTime(seconds)}</div>
              ${recording && html`<div class="meter"><div class="meter-fill" style=${`width:${Math.round(level * 100)}%`}></div></div>`}
              ${recording
                ? html`<button class="recbtn live" onClick=${stopRecording}><span class="pulse"></span> Stop recording</button>`
                : html`<button class="recbtn idle" onClick=${startRecording}>● Start recording</button>`}
              <div class="reclabel">${recording ? 'Recording — speak normally' : 'Record live, or add an existing audio file'}</div>

              ${!recording && micState === 'unsupported' && html`
                <div class="reclabel">This browser can’t record audio. Try Chrome, Safari, or Firefox on a secure (https) page.</div>`}

              ${!recording && micState !== 'unsupported' && html`
                <div class="devicebar">
                  ${micState === 'granted'
                    ? html`<select class="devsel" value=${deviceId} onChange=${e => setDeviceId(e.target.value)}>
                        <option value="">Default microphone</option>
                        ${devices.map((d, i) => html`<option value=${d.deviceId} selected=${d.deviceId === deviceId}>${d.label || ('Microphone ' + (i + 1))}</option>`)}
                      </select>`
                    : html`<button class="btn ghost" onClick=${enableMic}>🎙 Allow microphone to choose a device</button>`}
                </div>`}

              <div class="orrow">or</div>
              <label class="uploadbtn">
                Choose audio file
                <input type="file" accept="audio/*,video/*" style="display:none" onChange=${onFile} />
              </label>
            </div>
          </div>`}

        ${audio && html`
          <div class="card">
            <h2>Audio</h2>
            <div class="audiorow">
              <audio controls src=${audio.url}></audio>
              <span class="fname">${audio.name}</span>
            </div>
            <div class="btnrow">
              <button class="btn primary" disabled=${busy} onClick=${runTranscribe}>
                ${phase === 'idle' ? 'Transcribe & analyze' : 'Re-run'}
              </button>
            </div>
          </div>`}

        ${busy && html`
          <div class="card">
            <div class="status"><span class="spinner"></span>
              ${phase === 'transcribing' ? 'Transcribing audio with ElevenLabs Scribe…' : 'Structuring notes with Claude…'}
            </div>
          </div>`}

        ${error && html`<div class="notice err"><span>⚠️</span><span>${error}</span></div>`}

        ${turns && html`<${Results} turns=${turns} analysis=${analysis} tab=${tab} setTab=${setTab} />`}

        <div class="disclaimer">
          MedScribe is a note-taking aid, not a medical device or medical advice.<br/>
          Always confirm medications, doses, and instructions with your clinician.
        </div>
      `}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
function Settings({ settings, onSave }) {
  const [eleven, setEleven] = useState(settings.elevenKey || '');
  const [anthropic, setAnthropic] = useState(settings.anthropicKey || '');
  const [claudeModel, setClaudeModel] = useState(settings.claudeModel || 'claude-sonnet-5');
  const [scribeModel, setScribeModel] = useState(settings.scribeModel || 'scribe_v2');
  const [saved, setSaved] = useState(false);

  const save = () => {
    onSave({ elevenKey: eleven.trim(), anthropicKey: anthropic.trim(), claudeModel, scribeModel });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  };

  return html`
    <div class="card">
      <h2>Settings</h2>
      <div class="field">
        <label>ElevenLabs API key</label>
        <div class="hint">For transcription. Get one at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">elevenlabs.io</a>. Stored only in this browser.</div>
        <input type="password" value=${eleven} placeholder="sk_..." onInput=${e => setEleven(e.target.value)} />
      </div>
      <div class="field">
        <label>Anthropic API key</label>
        <div class="hint">For the summary & structured notes. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. Stored only in this browser.</div>
        <input type="password" value=${anthropic} placeholder="sk-ant-..." onInput=${e => setAnthropic(e.target.value)} />
      </div>
      <div class="field">
        <label>Transcription model</label>
        <select value=${scribeModel} onChange=${e => setScribeModel(e.target.value)}>
          ${SCRIBE_MODELS.map(m => html`<option value=${m.id} selected=${m.id === scribeModel}>${m.label}</option>`)}
        </select>
      </div>
      <div class="field">
        <label>Analysis model</label>
        <select value=${claudeModel} onChange=${e => setClaudeModel(e.target.value)}>
          ${CLAUDE_MODELS.map(m => html`<option value=${m.id} selected=${m.id === claudeModel}>${m.label}</option>`)}
        </select>
      </div>
      <div class="btnrow">
        <button class="btn primary" onClick=${save}>Save</button>
        ${saved && html`<span class="saved-tick">✓ saved locally</span>`}
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
const symColor = (s) => ({
  pain: '#c0392b', ache: '#d1743a', stiffness: '#b8860b', numbness: '#6a5acd',
  tingling: '#7b68b0', weakness: '#0f766e', swelling: '#2e8b57', instability: '#8e44ad',
}[s] || '#7a7a7a');

function Silhouette() {
  // simple, recognizable body outline — reused for front & back views
  return html`
    <g fill="var(--body-fill)" stroke="var(--body-stroke)" stroke-width="1.4" stroke-linejoin="round">
      <circle cx="50" cy="18" r="12" />
      <rect x="43" y="28" width="14" height="9" rx="4" />
      <path d="M31 38 Q50 32 69 38 L73 118 Q50 128 27 118 Z" />
      <path d="M32 42 L13 132 L21 135 L38 60 Z" />
      <path d="M68 42 L87 132 L79 135 L62 60 Z" />
      <path d="M41 120 L34 294 L45 294 L50 128 Z" />
      <path d="M59 120 L66 294 L55 294 L50 128 Z" />
    </g>`;
}

function BodyChart({ points }) {
  const pts = Array.isArray(points) ? points : [];
  const byView = { front: [], back: [] };
  pts.forEach(p => byView[p.view === 'back' ? 'back' : 'front'].push(p));
  const usedSymptoms = [...new Set(pts.map(p => p.symptom))];

  const figure = (view) => html`
    <div class="bcfig">
      <svg viewBox="0 0 100 300" class="bodysvg" role="img" aria-label=${view + ' body chart'}>
        <${Silhouette} />
        ${byView[view].map((p) => {
          const c = REGION_MAP[p.region] || { x: 50, y: 150 };
          const sev = typeof p.severity === 'number' ? Math.max(0, Math.min(10, p.severity)) : null;
          const r = 4.5 + (sev == null ? 2 : sev * 0.75);
          const col = symColor(p.symptom);
          return html`<g>
            <circle cx=${c.x} cy=${c.y} r=${r} fill=${col} fill-opacity="0.5" stroke=${col} stroke-width="1.4" />
            ${sev != null && html`<text x=${c.x} y=${c.y + 3.2} text-anchor="middle" font-size="7" font-weight="700" fill="#fff">${sev}</text>`}
          </g>`;
        })}
      </svg>
      <div class="bclabel">${view === 'front' ? 'Front' : 'Back'}</div>
    </div>`;

  if (!pts.length) return html`<p class="empty">No specific body areas were described.</p>`;

  return html`
    <div>
      <div class="bodychart">${figure('front')}${figure('back')}</div>
      ${usedSymptoms.length > 0 && html`
        <div class="symkey">
          ${usedSymptoms.map(s => html`<span class="symkey-item"><span class="dot" style=${`background:${symColor(s)}`}></span>${s}</span>`)}
        </div>`}
      <ul class="bclegend">
        ${pts.map(p => html`<li>
          <span class="dot" style=${`background:${symColor(p.symptom)}`}></span>
          <b>${prettyRegion(p.region)}</b> — ${p.symptom}${typeof p.severity === 'number' ? ` ${p.severity}/10` : ''}${p.notes ? ` · ${p.notes}` : ''}
        </li>`)}
      </ul>
    </div>`;
}

function Results({ turns, analysis, tab, setTab }) {
  const map = {};
  const labeled = turns.map(t => ({ ...t, who: speakerLabel(t.speaker, map) }));

  const copy = (text) => navigator.clipboard?.writeText(text);
  const download = (text, name) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };

  const notesText = analysis ? buildNotesText(analysis) : '';
  const plainTranscript = analysis?.cleaned_transcript
    || labeled.map(t => `${t.who}: ${t.text}`).join('\n\n');

  const soap = analysis?.soap || {};
  const hist = analysis?.medical_history || {};
  const goals = analysis?.goals || {};
  const noAnalysis = html`<p class="empty">Analysis not available. You can still read the Transcript tab.</p>`;

  const TABS = [
    ['soap', 'SOAP'], ['body', 'Body chart'], ['objective', 'Objective'],
    ['goals', 'Goals'], ['history', 'History'], ['overview', 'Overview'], ['transcript', 'Transcript'],
  ];

  return html`
    <div class="card">
      <div class="tabs scroll">
        ${TABS.map(([k, label]) => html`
          <button class=${'tab ' + (tab === k ? 'active' : '')} onClick=${() => setTab(k)}>${label}</button>`)}
      </div>

      ${tab === 'transcript' && html`
        <div>
          ${labeled.map(t => html`
            <div class="turn">
              <div><span class="who">${t.who}</span><span class="ts">${fmtTime(t.start)}</span></div>
              <div class="said">${t.text}</div>
            </div>`)}
          <div class="btnrow">
            <button class="btn ghost" onClick=${() => copy(plainTranscript)}>Copy</button>
            <button class="btn ghost" onClick=${() => download(plainTranscript, 'transcript.txt')}>Download .txt</button>
          </div>
        </div>`}

      ${tab === 'soap' && (!analysis ? noAnalysis : html`
        <div>
          ${[['S', 'Subjective', soap.subjective], ['O', 'Objective', soap.objective], ['A', 'Assessment', soap.assessment], ['P', 'Plan', soap.plan]].map(([k, label, val]) => html`
            <div class="soap-row">
              <div class="soap-key">${k}</div>
              <div class="soap-body">
                <h3>${label}</h3>
                <p>${val || html`<span class="empty">Not documented.</span>`}</p>
              </div>
            </div>`)}
          <div class="btnrow">
            <button class="btn ghost" onClick=${() => copy(notesText)}>Copy full note</button>
            <button class="btn ghost" onClick=${() => download(notesText, 'clinical-note.txt')}>Download .txt</button>
          </div>
        </div>`)}

      ${tab === 'body' && (!analysis ? noAnalysis : html`<${BodyChart} points=${analysis.body_chart} />`)}

      ${tab === 'objective' && (!analysis ? noAnalysis : html`
        <div>
          <div class="note-sec">
            <h3>Objective measures</h3>
            ${(analysis.objective_measures || []).length === 0
              ? html`<p class="empty">None recorded.</p>`
              : html`<div class="mtable">
                  ${(analysis.objective_measures || []).map(m => html`
                    <div class="mrow">
                      <div class="mn">${m.name}${m.side && m.side !== 'n/a' ? html` <span class="pill">${m.side}</span>` : ''}</div>
                      <div class="mv">${[m.value, m.unit].filter(Boolean).join(' ')}${m.notes ? html`<span class="mnote"> — ${m.notes}</span>` : ''}</div>
                    </div>`)}
                </div>`}
          </div>
          <${ListSec} title="Diagnoses / clinical impression" items=${analysis.diagnoses || []} />
        </div>`)}

      ${tab === 'goals' && (!analysis ? noAnalysis : html`
        <div>
          <${ListSec} title="Short-term goals" items=${goals.short_term || []} />
          <${ListSec} title="Long-term goals" items=${goals.long_term || []} />
        </div>`)}

      ${tab === 'history' && (!analysis ? noAnalysis : html`
        <div>
          <div class="note-sec"><h3>Presenting complaint</h3><p>${hist.presenting_complaint || html`<span class="empty">—</span>`}</p></div>
          <div class="note-sec"><h3>History of presenting complaint</h3><p>${hist.history_of_presenting_complaint || html`<span class="empty">—</span>`}</p></div>
          <${ListSec} title="Past medical history" items=${hist.past_medical_history || []} />
          <div class="note-sec">
            <h3>Current medications</h3>
            ${(hist.current_medications || []).length === 0
              ? html`<p class="empty">None recorded.</p>`
              : (hist.current_medications || []).map(m => html`
                <div class="med"><div class="mname">${m.name}</div><div class="mmeta">${[m.dosage, m.instructions].filter(Boolean).join(' · ')}</div></div>`)}
          </div>
          <${ListSec} title="Allergies" items=${hist.allergies || []} />
          <div class="note-sec"><h3>Social history</h3><p>${hist.social_history || html`<span class="empty">—</span>`}</p></div>
          ${(hist.red_flags || []).length > 0 && html`
            <div class="note-sec">
              <h3>⚠️ Red flags</h3>
              ${(hist.red_flags || []).map(f => html`<div class="notice warn" style="margin-bottom:8px">${f}</div>`)}
            </div>`}
        </div>`)}

      ${tab === 'overview' && (!analysis ? noAnalysis : html`
        <div>
          <div class="note-sec"><h3>Summary</h3><p>${analysis.summary || html`<span class="empty">—</span>`}</p></div>
          <${ListSec} title="Action items" items=${(analysis.action_items || []).map(a => typeof a === 'string' ? a : `${a.text}${a.owner ? ` — ${a.owner}` : ''}`)} check=${true} />
          <div class="note-sec"><h3>Follow-up</h3><p>${analysis.follow_up || html`<span class="empty">None specified.</span>`}</p></div>
          <${ListSec} title="Questions for next time" items=${analysis.questions_for_next_time || []} />
          <div class="btnrow">
            <button class="btn ghost" onClick=${() => copy(notesText)}>Copy full note</button>
            <button class="btn ghost" onClick=${() => download(notesText, 'clinical-note.txt')}>Download .txt</button>
          </div>
        </div>`)}
    </div>
  `;
}

function ListSec({ title, items, check }) {
  return html`
    <div class="note-sec">
      <h3>${title}</h3>
      ${(!items || items.length === 0)
        ? html`<p class="empty">None.</p>`
        : check
          ? items.map(it => html`<div class="checkitem"><span class="box">☐</span><span>${it}</span></div>`)
          : html`<ul>${items.map(it => html`<li>${it}</li>`)}</ul>`}
    </div>
  `;
}

function buildNotesText(a) {
  const L = [];
  const h = a.medical_history || {};
  const s = a.soap || {};
  const g = a.goals || {};
  L.push('CLINICAL NOTE', '');
  if (a.summary) L.push('SUMMARY', a.summary, '');

  L.push('HISTORY');
  if (h.presenting_complaint) L.push('Presenting complaint: ' + h.presenting_complaint);
  if (h.history_of_presenting_complaint) L.push('HPC: ' + h.history_of_presenting_complaint);
  if (h.past_medical_history?.length) L.push('PMH: ' + h.past_medical_history.join('; '));
  if (h.current_medications?.length) L.push('Medications: ' + h.current_medications.map(m => `${m.name}${m.dosage ? ' ' + m.dosage : ''}`).join('; '));
  if (h.allergies?.length) L.push('Allergies: ' + h.allergies.join('; '));
  if (h.social_history) L.push('Social: ' + h.social_history);
  if (h.red_flags?.length) L.push('RED FLAGS: ' + h.red_flags.join('; '));
  L.push('');

  L.push('SOAP');
  L.push('S: ' + (s.subjective || '—'));
  L.push('O: ' + (s.objective || '—'));
  L.push('A: ' + (s.assessment || '—'));
  L.push('P: ' + (s.plan || '—'));
  L.push('');

  if (a.diagnoses?.length) L.push('DIAGNOSES / IMPRESSION', ...a.diagnoses.map(d => '• ' + d), '');

  if (a.body_chart?.length) {
    L.push('BODY CHART');
    a.body_chart.forEach(p => L.push(`• ${prettyRegion(p.region)} (${p.view}) — ${p.symptom}${typeof p.severity === 'number' ? ` ${p.severity}/10` : ''}${p.notes ? ` · ${p.notes}` : ''}`));
    L.push('');
  }
  if (a.objective_measures?.length) {
    L.push('OBJECTIVE MEASURES');
    a.objective_measures.forEach(m => L.push(`• ${m.name}${m.side && m.side !== 'n/a' ? ` (${m.side})` : ''}: ${[m.value, m.unit].filter(Boolean).join(' ')}${m.notes ? ` — ${m.notes}` : ''}`));
    L.push('');
  }
  if (g.short_term?.length || g.long_term?.length) {
    L.push('GOALS');
    if (g.short_term?.length) L.push('Short-term:', ...g.short_term.map(x => '• ' + x));
    if (g.long_term?.length) L.push('Long-term:', ...g.long_term.map(x => '• ' + x));
    L.push('');
  }
  if (a.action_items?.length) {
    L.push('ACTION ITEMS');
    a.action_items.forEach(it => L.push('☐ ' + (typeof it === 'string' ? it : `${it.text}${it.owner ? ` — ${it.owner}` : ''}`)));
    L.push('');
  }
  if (a.follow_up) L.push('FOLLOW-UP', a.follow_up, '');
  if (a.questions_for_next_time?.length) L.push('QUESTIONS FOR NEXT TIME', ...a.questions_for_next_time.map(q => '• ' + q), '');
  L.push('', '— Generated by MedScribe. Verify all clinical details before use.');
  return L.join('\n');
}

render(html`<${App} />`, document.getElementById('app'));
