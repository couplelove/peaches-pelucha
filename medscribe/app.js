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
const SYSTEM_PROMPT = `You are a careful medical-scribe assistant. You turn a raw, possibly messy transcript of a doctor's appointment into clear notes for the PATIENT to review after the visit.

Hard rules:
- Never invent facts. Only use what is in the transcript. If something was not discussed, leave that field empty rather than guessing.
- Do not give new medical advice or add recommendations that the clinician did not state. You are summarizing what was said, not diagnosing.
- Preserve exact medication names, doses, and numbers as spoken. If a number is unclear in the transcript, mark it with "(verify)".
- Plain, warm, non-alarming language.
- Record your result by calling the record_visit_notes tool — do not reply with prose.`;

// Forced tool-use gives us guaranteed structured output. (Current Claude models
// no longer accept the assistant-message JSON prefill trick, so we don't use it.)
const NOTES_TOOL = {
  name: 'record_visit_notes',
  description: 'Record the structured, patient-friendly notes extracted from the appointment transcript.',
  input_schema: {
    type: 'object',
    properties: {
      cleaned_transcript: { type: 'string', description: 'Transcript with speaker labels (Doctor / Patient where obvious, otherwise Speaker 1 / 2), filler words and stutters removed, obvious transcription errors fixed — but faithful to meaning. Line breaks between turns.' },
      summary: { type: 'string', description: '2-4 sentence plain-language recap of what happened in the visit.' },
      diagnoses: { type: 'array', items: { type: 'string' }, description: 'Conditions or assessments the clinician actually named.' },
      medications: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, dosage: { type: 'string' }, instructions: { type: 'string' } }, required: ['name'] } },
      tests_ordered: { type: 'array', items: { type: 'string' }, description: 'Labs, imaging, or referrals ordered.' },
      action_items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string' } }, required: ['text'] } },
      follow_up: { type: 'string', description: 'When/whether to come back, as stated. Empty string if none.' },
      questions_for_next_time: { type: 'array', items: { type: 'string' }, description: 'Useful questions grounded in this visit.' },
    },
    required: ['cleaned_transcript', 'summary', 'diagnoses', 'medications', 'tests_ordered', 'action_items', 'follow_up', 'questions_for_next_time'],
  },
};

async function analyzeTranscript({ transcript, apiKey, model }) {
  const body = {
    model: model || 'claude-sonnet-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [NOTES_TOOL],
    tool_choice: { type: 'tool', name: 'record_visit_notes' },
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

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */
function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(!loadSettings().elevenKey || !loadSettings().anthropicKey);

  const [audio, setAudio] = useState(null); // { blob, url, name }
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // microphone / device state
  const [devices, setDevices] = useState([]);      // audioinput MediaDeviceInfo[]
  const [deviceId, setDeviceId] = useState('');    // '' = system default
  const [micState, setMicState] = useState('unknown'); // unknown|prompt|granted|denied|unsupported
  const [level, setLevel] = useState(0);           // live input level 0..1

  const [phase, setPhase] = useState('idle'); // idle | transcribing | transcribed | analyzing | done
  const [turns, setTurns] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [tab, setTab] = useState('notes');
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
      setAnalysis(a); setPhase('done'); setTab('notes');
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

        ${!keysReady && html`
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

  return html`
    <div class="card">
      <div class="tabs">
        <button class=${'tab ' + (tab === 'notes' ? 'active' : '')} onClick=${() => setTab('notes')}>Visit notes</button>
        <button class=${'tab ' + (tab === 'summary' ? 'active' : '')} onClick=${() => setTab('summary')}>Summary</button>
        <button class=${'tab ' + (tab === 'transcript' ? 'active' : '')} onClick=${() => setTab('transcript')}>Transcript</button>
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

      ${tab === 'summary' && html`
        ${!analysis ? html`<p class="empty">Analysis not available.</p>` : html`
        <div>
          <div class="note-sec">
            <h3>Summary</h3>
            <p>${analysis.summary || html`<span class="empty">—</span>`}</p>
          </div>
          <${ListSec} title="Action items" items=${(analysis.action_items || []).map(a => typeof a === 'string' ? a : `${a.text}${a.owner ? ` — ${a.owner}` : ''}`)} check=${true} />
          <${ListSec} title="Questions for next time" items=${analysis.questions_for_next_time || []} />
          <div class="btnrow"><button class="btn ghost" onClick=${() => copy(notesText)}>Copy all notes</button></div>
        </div>`}`}

      ${tab === 'notes' && html`
        ${!analysis ? html`<p class="empty">Analysis not available. You can still read the transcript tab.</p>` : html`
        <div>
          <div class="note-sec">
            <h3>Summary</h3>
            <p>${analysis.summary || html`<span class="empty">—</span>`}</p>
          </div>
          <${ListSec} title="Diagnoses / assessment" items=${analysis.diagnoses || []} />
          <div class="note-sec">
            <h3>Medications</h3>
            ${(analysis.medications || []).length === 0
              ? html`<p class="empty">None discussed.</p>`
              : (analysis.medications || []).map(m => html`
                <div class="med">
                  <div class="mname">${m.name}</div>
                  <div class="mmeta">${[m.dosage, m.instructions].filter(Boolean).join(' · ')}</div>
                </div>`)}
          </div>
          <${ListSec} title="Tests & referrals ordered" items=${analysis.tests_ordered || []} />
          <${ListSec} title="Action items" items=${(analysis.action_items || []).map(a => typeof a === 'string' ? a : `${a.text}${a.owner ? ` — ${a.owner}` : ''}`)} check=${true} />
          <div class="note-sec">
            <h3>Follow-up</h3>
            <p>${analysis.follow_up || html`<span class="empty">None specified.</span>`}</p>
          </div>
          <div class="btnrow">
            <button class="btn ghost" onClick=${() => copy(notesText)}>Copy notes</button>
            <button class="btn ghost" onClick=${() => download(notesText, 'visit-notes.txt')}>Download .txt</button>
          </div>
        </div>`}`}
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
  L.push('VISIT NOTES', '');
  if (a.summary) L.push('SUMMARY', a.summary, '');
  if (a.diagnoses?.length) L.push('DIAGNOSES / ASSESSMENT', ...a.diagnoses.map(d => '• ' + d), '');
  if (a.medications?.length) {
    L.push('MEDICATIONS');
    a.medications.forEach(m => L.push(`• ${m.name}${m.dosage ? ` — ${m.dosage}` : ''}${m.instructions ? ` (${m.instructions})` : ''}`));
    L.push('');
  }
  if (a.tests_ordered?.length) L.push('TESTS & REFERRALS', ...a.tests_ordered.map(t => '• ' + t), '');
  if (a.action_items?.length) {
    L.push('ACTION ITEMS');
    a.action_items.forEach(it => L.push('☐ ' + (typeof it === 'string' ? it : `${it.text}${it.owner ? ` — ${it.owner}` : ''}`)));
    L.push('');
  }
  if (a.follow_up) L.push('FOLLOW-UP', a.follow_up, '');
  if (a.questions_for_next_time?.length) L.push('QUESTIONS FOR NEXT TIME', ...a.questions_for_next_time.map(q => '• ' + q), '');
  L.push('', '— Generated by MedScribe. Confirm all details with your clinician.');
  return L.join('\n');
}

render(html`<${App} />`, document.getElementById('app'));
