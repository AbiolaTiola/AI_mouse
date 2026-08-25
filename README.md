# Hifz Companion — Quran Memorization App

A lightweight, no-build web app for memorizing the Quran verse-by-verse with
automatic repetition and pauses so you can repeat after the reciter.

## Features

- Pick any Surah and an ayah range (e.g. verses 1–7).
- Choose a reciter — Al-Afasy, Al-Husary, Abdul Basit, El-Minshawi, Al-Sudais
  are built in (verse-by-verse audio, so each ayah plays and repeats on its own).
- Each verse is repeated a configurable number of times (default 3).
- An automatic silent pause after every repeat gives you time to repeat the
  verse out loud before it plays again.
- A pause between verses, and the option to loop the whole range multiple
  times per session.
- Arabic text (Uthmani script) and an English translation for every verse,
  toggleable.
- Settings and your last surah/range are remembered between visits
  (`localStorage`).

## About Goni Tohir Dahiru and other reciters not on public APIs

There's no public, per-verse audio API for every beloved reciter — Sheikh
Goni Tohir Dahiru's recitation, for example, isn't on the standard Quran
audio services this app pulls from. Rather than guess at a link that might
be broken, mislabeled, or not actually his voice, the app gives you two ways
to add him (or anyone else) yourself, from **⚙️ → "+ Add a reciter"**:

1. **URL pattern** — if you have a hosting source (your own server, a GitHub
   raw file host, etc.) that serves one MP3 per verse, add it as a template,
   e.g. `https://your-host.example/goni-tohir/{surah3}{ayah3}.mp3`
   (`{surah3}`/`{ayah3}` are zero-padded to 3 digits, matching the common
   `SSSAAA.mp3` convention; `{surah}`/`{ayah}` are also available unpadded).
2. **Your own recordings** — press the 🎙️ **"attach audio for this verse"**
   button on any verse (with any reciter selected) to upload an audio file
   for just that verse. It's stored privately in your browser (IndexedDB)
   and always takes priority over the built-in source for that reciter +
   verse. Do this verse-by-verse as you collect his recordings, or select
   the built-in **"My Uploaded Recitation"** reciter to build an entirely
   self-recorded/self-collected reciter library.

## Running it

No build step or dependencies — it's static HTML/CSS/JS.

```bash
# from this directory
python3 -m http.server 8080
# then open http://localhost:8080
```

Or open `index.html` directly in a modern browser (Chrome, Firefox, Safari,
Edge). Playback and repetition all run client-side.

To deploy it publicly, push this folder to GitHub Pages, Netlify, Vercel, or
any static host.

## Data sources

- Quran text & translation: [AlQuran Cloud API](https://alquran.cloud/api)
  (`quran-uthmani` Arabic text, `en.sahih` English translation).
- Built-in reciter audio: [EveryAyah.com](https://everyayah.com) verse-by-verse
  MP3s.

Both are fetched live from the browser — an internet connection is required.

## Notes

- Repeat count, pause durations, reciter, and range are all adjustable in the
  ⚙️ Settings panel.
- "Repeat whole range" lets you loop verses 1–7 (for example) as a block
  several times, on top of each verse's own repeat count.
- Uploaded/attached audio lives only in your browser's local storage — it
  isn't uploaded anywhere.
