'use strict';

/* ---------- Constants ---------- */

const QURAN_API = 'https://api.alquran.cloud/v1';
const TRANSLATION_EDITION = 'en.sahih';
const ARABIC_EDITION = 'quran-uthmani';

// Built-in reciters: verse-by-verse audio via EveryAyah.com's folder convention.
// (id, display name, EveryAyah folder). These are well-known reciters with
// stable per-ayah files, so automatic repeat/pause can target a single verse.
const BUILTIN_RECITERS = [
  { id: 'alafasy', name: 'Mishary Rashid Al-Afasy', folder: 'Alafasy_128kbps' },
  { id: 'husary', name: 'Mahmoud Khalil Al-Husary', folder: 'Husary_128kbps' },
  { id: 'abdulbasit', name: 'Abdul Basit (Murattal)', folder: 'Abdul_Basit_Murattal_192kbps' },
  { id: 'minshawy', name: 'Mohamed Siddiq El-Minshawi', folder: 'Minshawy_Murattal_128kbps' },
  { id: 'sudais', name: 'Abdul Rahman Al-Sudais', folder: 'Abdurrahmaan_As-Sudais_192kbps' },
];

const LS_KEYS = {
  settings: 'hifz.settings.v1',
  customReciters: 'hifz.customReciters.v1',
};

const UPLOAD_RECITER_ID = 'my-uploads';

/* ---------- Small helpers ---------- */

const $ = (sel) => document.querySelector(sel);
const pad3 = (n) => String(n).padStart(3, '0');
const sleep = (ms) => new Promise((resolve) => {
  activeTimeoutId = setTimeout(resolve, ms);
});

let activeTimeoutId = null;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore quota errors */ }
}

/* ---------- IndexedDB for user-uploaded verse audio ---------- */

const DB_NAME = 'hifz-audio-db';
const STORE_NAME = 'verseAudio';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function audioKey(reciterId, surah, ayah) {
  return `${reciterId}|${surah}|${ayah}`;
}

async function storeVerseAudio(reciterId, surah, ayah, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key: audioKey(reciterId, surah, ayah), blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getVerseAudio(reciterId, surah, ayah) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(audioKey(reciterId, surah, ayah));
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- State ---------- */

const state = {
  surahs: [],
  currentSurahMeta: null,
  ayahs: [],           // [{ number, numberInSurah, arabic, translation }]
  rangeStart: 1,
  rangeEnd: 1,
  reciters: [],         // built-in + custom, resolved list
  reciterId: BUILTIN_RECITERS[0].id,
  repeatCount: 3,
  pauseAfter: 4,
  pauseBetween: 1.5,
  rangeRepeats: 1,
  showTranslation: true,
  advanceMode: true,

  playing: false,
  currentIndex: 0,      // index into ayahs (relative to full surah array)
  currentRep: 1,
  rangePass: 1,
  sessionToken: 0,       // bumped to cancel in-flight playback loops
};

/* ---------- DOM refs ---------- */

const el = {};

function cacheDom() {
  [
    'settingsToggle', 'settingsPanel', 'surahSelect', 'startAyah', 'endAyah',
    'reciterSelect', 'addReciterBtn', 'repeatCount', 'repeatCountVal',
    'pauseAfter', 'pauseAfterVal', 'pauseBetween', 'pauseBetweenVal',
    'rangeRepeats', 'rangeRepeatsVal', 'showTranslation', 'advanceMode',
    'reciterHint', 'progressLabel', 'progressFill', 'verseRef',
    'uploadVerseBtn', 'arabicText', 'translationText', 'turnBanner',
    'audioEl', 'fileInput', 'prevBtn', 'playBtn', 'stopBtn', 'nextBtn',
    'repStatus', 'loadStatus', 'addReciterDialog', 'addReciterForm',
    'newReciterName', 'newReciterType', 'templateField', 'newReciterTemplate',
    'cancelReciterBtn',
  ].forEach((id) => { el[id] = document.getElementById(id); });
}

/* ---------- Reciter list management ---------- */

function getCustomReciters() {
  return loadJSON(LS_KEYS.customReciters, []);
}

function buildReciterList() {
  const custom = getCustomReciters();
  state.reciters = [
    ...BUILTIN_RECITERS.map((r) => ({ ...r, type: 'everyayah' })),
    ...custom,
    { id: UPLOAD_RECITER_ID, name: 'My Uploaded Recitation', type: 'upload' },
  ];
}

function populateReciterSelect() {
  buildReciterList();
  el.reciterSelect.innerHTML = '';
  for (const r of state.reciters) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    el.reciterSelect.appendChild(opt);
  }
  if (state.reciters.some((r) => r.id === state.reciterId)) {
    el.reciterSelect.value = state.reciterId;
  } else {
    state.reciterId = state.reciters[0].id;
    el.reciterSelect.value = state.reciterId;
  }
  updateReciterHint();
}

function currentReciter() {
  return state.reciters.find((r) => r.id === state.reciterId) || state.reciters[0];
}

function updateReciterHint() {
  const r = currentReciter();
  if (!r) { el.reciterHint.textContent = ''; return; }
  if (r.type === 'upload') {
    el.reciterHint.textContent = 'Uses only the audio you attach per verse with the 🎙️ button below. Great for reciters like Goni Tohir Dahiru whose recitation isn’t on a public per-verse audio API.';
  } else if (r.type === 'template') {
    el.reciterHint.textContent = `Custom source: ${r.template}. You can still override any single verse with the 🎙️ button.`;
  } else {
    el.reciterHint.textContent = 'You can override any single verse with your own recording using the 🎙️ button.';
  }
}

function everyAyahUrl(folder, surah, ayah) {
  return `https://everyayah.com/data/${folder}/${pad3(surah)}${pad3(ayah)}.mp3`;
}

function templateUrl(template, surah, ayah) {
  return template
    .replaceAll('{surah3}', pad3(surah))
    .replaceAll('{ayah3}', pad3(ayah))
    .replaceAll('{surah}', String(surah))
    .replaceAll('{ayah}', String(ayah));
}

let lastObjectUrl = null;

async function resolveAudioSrc(surah, ayah) {
  const r = currentReciter();

  // A per-verse recording attached via the 🎙️ button always takes priority
  // for whichever reciter is currently selected (lets you keep a built-in
  // reciter but override one tricky verse with your own voice, or with a
  // reciter like Goni Tohir Dahiru who has no public per-verse audio API).
  const override = await getVerseAudio(r.id, surah, ayah);
  if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  if (override) {
    lastObjectUrl = URL.createObjectURL(override);
    return lastObjectUrl;
  }

  if (r.type === 'everyayah') return everyAyahUrl(r.folder, surah, ayah);
  if (r.type === 'template') return templateUrl(r.template, surah, ayah);
  return null; // 'upload' reciter with nothing attached yet for this verse
}

/* ---------- API loading ---------- */

async function loadSurahList() {
  const res = await fetch(`${QURAN_API}/surah`);
  if (!res.ok) throw new Error(`Surah list request failed (${res.status})`);
  const json = await res.json();
  state.surahs = json.data;
  el.surahSelect.innerHTML = '';
  for (const s of state.surahs) {
    const opt = document.createElement('option');
    opt.value = s.number;
    opt.textContent = `${s.number}. ${s.englishName} (${s.name})`;
    el.surahSelect.appendChild(opt);
  }
}

async function loadSurahText(surahNumber) {
  setLoadStatus('Loading surah text…');
  const res = await fetch(`${QURAN_API}/surah/${surahNumber}/editions/${ARABIC_EDITION},${TRANSLATION_EDITION}`);
  if (!res.ok) throw new Error(`Surah text request failed (${res.status})`);
  const json = await res.json();
  const [arabicEd, translationEd] = json.data;
  state.currentSurahMeta = state.surahs.find((s) => s.number === surahNumber);
  state.ayahs = arabicEd.ayahs.map((a, i) => ({
    number: a.number,
    numberInSurah: a.numberInSurah,
    arabic: a.text,
    translation: translationEd.ayahs[i] ? translationEd.ayahs[i].text : '',
  }));
  setLoadStatus('');
  populateAyahRangeSelects();
}

function populateAyahRangeSelects() {
  const count = state.ayahs.length;
  for (const sel of [el.startAyah, el.endAyah]) {
    sel.innerHTML = '';
    for (let i = 1; i <= count; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      sel.appendChild(opt);
    }
  }
  state.rangeStart = 1;
  state.rangeEnd = count;
  el.startAyah.value = 1;
  el.endAyah.value = count;
}

/* ---------- Rendering ---------- */

function ayahAt(index) { return state.ayahs[index]; }

function renderVerse(index) {
  const ayah = ayahAt(index);
  if (!ayah) return;
  el.verseRef.textContent = `${state.currentSurahMeta.englishName} ${ayah.numberInSurah}`;
  el.arabicText.textContent = ayah.arabic;
  el.translationText.textContent = state.showTranslation ? ayah.translation : '';
  el.translationText.classList.toggle('hidden', !state.showTranslation);

  const total = state.rangeEnd - state.rangeStart + 1;
  const done = index - (state.rangeStart - 1);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el.progressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  el.progressLabel.textContent = `Verse ${ayah.numberInSurah} — ${done + 1} of ${total}` +
    (state.rangeRepeats > 1 ? ` · pass ${state.rangePass}/${state.rangeRepeats}` : '');
}

function renderRepStatus() {
  el.repStatus.textContent = state.playing
    ? `Repeat ${state.currentRep} of ${state.repeatCount}`
    : '';
}

function setLoadStatus(msg, isError) {
  el.loadStatus.textContent = msg || '';
  el.loadStatus.classList.toggle('error', !!isError);
}

function showTurnBanner(show) {
  el.turnBanner.classList.toggle('hidden', !show);
}

/* ---------- Settings persistence ---------- */

function persistSettings() {
  saveJSON(LS_KEYS.settings, {
    reciterId: state.reciterId,
    repeatCount: state.repeatCount,
    pauseAfter: state.pauseAfter,
    pauseBetween: state.pauseBetween,
    rangeRepeats: state.rangeRepeats,
    showTranslation: state.showTranslation,
    advanceMode: state.advanceMode,
    surahNumber: state.currentSurahMeta ? state.currentSurahMeta.number : null,
    rangeStart: state.rangeStart,
    rangeEnd: state.rangeEnd,
  });
}

function restoreSettings() {
  const s = loadJSON(LS_KEYS.settings, null);
  if (!s) return null;
  state.reciterId = s.reciterId || state.reciterId;
  state.repeatCount = s.repeatCount || state.repeatCount;
  state.pauseAfter = s.pauseAfter ?? state.pauseAfter;
  state.pauseBetween = s.pauseBetween ?? state.pauseBetween;
  state.rangeRepeats = s.rangeRepeats || state.rangeRepeats;
  state.showTranslation = s.showTranslation ?? state.showTranslation;
  state.advanceMode = s.advanceMode ?? state.advanceMode;
  return s;
}

function applySettingsToControls() {
  el.repeatCount.value = state.repeatCount;
  el.repeatCountVal.textContent = state.repeatCount;
  el.pauseAfter.value = state.pauseAfter;
  el.pauseAfterVal.textContent = state.pauseAfter;
  el.pauseBetween.value = state.pauseBetween;
  el.pauseBetweenVal.textContent = state.pauseBetween;
  el.rangeRepeats.value = state.rangeRepeats;
  el.rangeRepeatsVal.textContent = state.rangeRepeats;
  el.showTranslation.checked = state.showTranslation;
  el.advanceMode.checked = state.advanceMode;
}

/* ---------- Playback engine ---------- */
// For each verse in [rangeStart, rangeEnd]: play audio -> wait ended -> pause
// (silence) `pauseAfter` seconds for the learner to repeat -> repeat
// `repeatCount` times total -> pause `pauseBetween` -> next verse.
// The whole range can itself be repeated `rangeRepeats` times.

function stopPlayback() {
  state.sessionToken++; // invalidate any in-flight async loop
  state.playing = false;
  if (activeTimeoutId) { clearTimeout(activeTimeoutId); activeTimeoutId = null; }
  el.audioEl.pause();
  el.audioEl.removeAttribute('src');
  showTurnBanner(false);
  renderRepStatus();
  updatePlayButton();
}

function updatePlayButton() {
  el.playBtn.textContent = state.playing ? '⏸' : '▶️';
  el.playBtn.title = state.playing ? 'Pause' : 'Play';
}

function playAudioOnce(src) {
  return new Promise((resolve, reject) => {
    if (!src) { reject(new Error('no-audio')); return; }
    el.audioEl.src = src;
    const onEnded = () => cleanup(resolve);
    const onError = () => cleanup(() => reject(new Error('load-error')));
    function cleanup(fn) {
      el.audioEl.removeEventListener('ended', onEnded);
      el.audioEl.removeEventListener('error', onError);
      fn();
    }
    el.audioEl.addEventListener('ended', onEnded);
    el.audioEl.addEventListener('error', onError);
    el.audioEl.currentTime = 0;
    el.audioEl.play().catch((e) => cleanup(() => reject(e)));
  });
}

async function runPlaybackLoop() {
  const myToken = state.sessionToken;
  const startIdx = state.rangeStart - 1;
  const endIdx = state.rangeEnd - 1;

  for (state.rangePass = 1; state.rangePass <= state.rangeRepeats; state.rangePass++) {
    for (let i = startIdx; i <= endIdx; i++) {
      if (state.sessionToken !== myToken) return;
      state.currentIndex = i;
      renderVerse(i);

      const ayah = ayahAt(i);
      const src = await resolveAudioSrc(ayah.number, ayah.numberInSurah);

      for (state.currentRep = 1; state.currentRep <= state.repeatCount; state.currentRep++) {
        if (state.sessionToken !== myToken) return;
        renderRepStatus();
        showTurnBanner(false);
        setLoadStatus('');
        try {
          await playAudioOnce(src);
        } catch (e) {
          if (state.sessionToken !== myToken) return; // cancelled via Stop, not a real error
          setLoadStatus(
            src ? 'Could not load audio for this verse — check the reciter source.' : 'No audio attached for this verse yet.',
            true
          );
        }
        if (state.sessionToken !== myToken) return;

        if (state.pauseAfter > 0) {
          showTurnBanner(true);
          await sleep(state.pauseAfter * 1000);
          showTurnBanner(false);
          if (state.sessionToken !== myToken) return;
        }
      }

      if (i < endIdx && state.pauseBetween > 0) {
        await sleep(state.pauseBetween * 1000);
        if (state.sessionToken !== myToken) return;
      }
    }
    if (!state.advanceMode) break; // single-verse mode: stop after one verse/pass
  }

  state.playing = false;
  updatePlayButton();
  renderRepStatus();
  setLoadStatus('Session complete 🎉');
}

function startPlayback() {
  if (state.ayahs.length === 0) return;
  state.playing = true;
  updatePlayButton();
  runPlaybackLoop();
}

function togglePlay() {
  if (state.playing) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function goToVerse(index) {
  stopPlayback();
  state.currentIndex = Math.min(Math.max(index, state.rangeStart - 1), state.rangeEnd - 1);
  renderVerse(state.currentIndex);
}

/* ---------- Event wiring ---------- */

function wireEvents() {
  el.settingsToggle.addEventListener('click', () => {
    el.settingsPanel.classList.toggle('hidden');
  });

  el.surahSelect.addEventListener('change', async () => {
    stopPlayback();
    const num = Number(el.surahSelect.value);
    try {
      await loadSurahText(num);
      renderVerse(state.rangeStart - 1);
      persistSettings();
    } catch (e) {
      setLoadStatus('Could not load that surah. Check your connection and try again.', true);
    }
  });

  el.startAyah.addEventListener('change', () => {
    state.rangeStart = Number(el.startAyah.value);
    if (state.rangeStart > state.rangeEnd) {
      state.rangeEnd = state.rangeStart;
      el.endAyah.value = state.rangeEnd;
    }
    renderVerse(state.rangeStart - 1);
    persistSettings();
  });

  el.endAyah.addEventListener('change', () => {
    state.rangeEnd = Number(el.endAyah.value);
    if (state.rangeEnd < state.rangeStart) {
      state.rangeStart = state.rangeEnd;
      el.startAyah.value = state.rangeStart;
    }
    persistSettings();
  });

  el.reciterSelect.addEventListener('change', () => {
    stopPlayback();
    state.reciterId = el.reciterSelect.value;
    updateReciterHint();
    persistSettings();
  });

  el.repeatCount.addEventListener('input', () => {
    state.repeatCount = Number(el.repeatCount.value);
    el.repeatCountVal.textContent = state.repeatCount;
    persistSettings();
  });
  el.pauseAfter.addEventListener('input', () => {
    state.pauseAfter = Number(el.pauseAfter.value);
    el.pauseAfterVal.textContent = state.pauseAfter;
    persistSettings();
  });
  el.pauseBetween.addEventListener('input', () => {
    state.pauseBetween = Number(el.pauseBetween.value);
    el.pauseBetweenVal.textContent = state.pauseBetween;
    persistSettings();
  });
  el.rangeRepeats.addEventListener('input', () => {
    state.rangeRepeats = Number(el.rangeRepeats.value);
    el.rangeRepeatsVal.textContent = state.rangeRepeats;
    persistSettings();
  });
  el.showTranslation.addEventListener('change', () => {
    state.showTranslation = el.showTranslation.checked;
    renderVerse(state.currentIndex);
    persistSettings();
  });
  el.advanceMode.addEventListener('change', () => {
    state.advanceMode = el.advanceMode.checked;
    persistSettings();
  });

  el.playBtn.addEventListener('click', togglePlay);
  el.stopBtn.addEventListener('click', stopPlayback);
  el.prevBtn.addEventListener('click', () => goToVerse(state.currentIndex - 1));
  el.nextBtn.addEventListener('click', () => goToVerse(state.currentIndex + 1));

  el.uploadVerseBtn.addEventListener('click', () => {
    el.fileInput.value = '';
    el.fileInput.onchange = async () => {
      const file = el.fileInput.files[0];
      if (!file) return;
      const ayah = ayahAt(state.currentIndex);
      const reciterId = currentReciter().id;
      await storeVerseAudio(reciterId, ayah.number, ayah.numberInSurah, file);
      setLoadStatus('Audio attached for this verse.');
    };
    el.fileInput.click();
  });

  // Add-reciter dialog
  el.addReciterBtn.addEventListener('click', () => el.addReciterDialog.showModal());
  el.cancelReciterBtn.addEventListener('click', () => el.addReciterDialog.close());
  el.newReciterType.addEventListener('change', () => {
    el.templateField.classList.toggle('hidden', el.newReciterType.value !== 'template');
  });
  el.addReciterForm.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const name = el.newReciterName.value.trim();
    const type = el.newReciterType.value;
    const template = el.newReciterTemplate.value.trim();
    if (!name) return;
    if (type === 'template' && !template) {
      setLoadStatus('Please provide a URL template.', true);
      return;
    }
    const custom = getCustomReciters();
    const id = `custom-${Date.now()}`;
    custom.push(type === 'template'
      ? { id, name, type: 'template', template }
      : { id, name, type: 'upload' });
    saveJSON(LS_KEYS.customReciters, custom);
    state.reciterId = id;
    populateReciterSelect();
    el.addReciterDialog.close();
    el.addReciterForm.reset();
    persistSettings();
  });
}

/* ---------- Init ---------- */

async function init() {
  cacheDom();
  populateReciterSelect();
  const saved = restoreSettings();
  applySettingsToControls();
  populateReciterSelect(); // re-run after restoring reciterId
  wireEvents();

  try {
    await loadSurahList();

    const startSurah = saved && saved.surahNumber ? saved.surahNumber : 1;
    el.surahSelect.value = startSurah;
    await loadSurahText(startSurah);

    if (saved) {
      state.rangeStart = Math.min(saved.rangeStart || 1, state.ayahs.length);
      state.rangeEnd = Math.min(saved.rangeEnd || state.ayahs.length, state.ayahs.length);
      el.startAyah.value = state.rangeStart;
      el.endAyah.value = state.rangeEnd;
    }

    renderVerse(state.rangeStart - 1);
  } catch (e) {
    setLoadStatus('Could not reach the Quran text service. Check your internet connection and reload.', true);
  }
}

document.addEventListener('DOMContentLoaded', init);
