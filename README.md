# BookVoice

> // This app was built by CeeJay for Chinedum Aranotu – 2026

![BookVoice](https://img.shields.io/badge/BookVoice-v1.0-BA7517?style=for-the-badge)
![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000?style=for-the-badge&logo=vercel)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

**BookVoice** turns your PDF and EPUB books into a full audiobook experience — right in the browser. Upload a book, pick a voice, and listen on the go. Skip to any chapter, tap any word to start reading from there, and let AI narrate your entire library with natural-sounding voices.

Built for people who have more books than time to sit and read them.

---

## Live Demo

🌐 **[bookvoice.vercel.app](https://bookvoice.vercel.app)**

---

## Screenshots

| Upload Screen | Player | Bookmarks |
|---|---|---|
| <img width="836" height="473" alt="Image" src="https://github.com/user-attachments/assets/047c591d-0854-4417-a031-3d8301643242" /> | <img width="658" height="230" alt="Image" src="https://github.com/user-attachments/assets/8a4c24ce-93f3-4117-87d6-e5bd89cdd1ea" /> | <img width="667" height="273" alt="Image" src="https://github.com/user-attachments/assets/0f084c68-b4b2-4a8c-afe6-62560243646e" /> |

---

## Features

### Core Playback
- **PDF & EPUB support** — drag and drop or click to upload any PDF or EPUB file
- **Auto chapter detection** — reads the book's built-in outline first, falls back to pattern detection (Chapter 1, Part II, Prologue etc.), then groups by pages
- **Full player controls** — play, pause, resume, prev/next page, prev/next chapter
- **±10 second skip** — jump back or forward 10 seconds within the current audio
- **Speed control** — 0.75×, 1×, 1.25×, 1.5×, 2× — applies instantly without restarting
- **Click any word** — tap any word on the page to start reading from exactly that point

### AI Voices (OpenAI TTS)
- **6 premium AI voices** — Nova, Shimmer, Alloy, Echo, Fable, Onyx
- **Browser voice fallback** — free, works offline, no API key needed
- **Seamless audio** — chunks are pre-fetched in the background so there are no gaps between sentences
- **Word highlight tracking** — the current word being read is highlighted as playback progresses

### Smart Features
- **AI Chapter Summary** — GPT-4o-mini generates a 2-sentence summary when you enter each chapter so you know what's coming
- **Speed Recommendation** — analyses sentence length and vocabulary complexity, suggests the best playback speed for the text
- **Auto-skip Front Matter** — copyright pages, dedications, and table of contents are detected and marked. Opens at Chapter 1 automatically on first load
- **Reading Progress Saved** — your exact chapter and page position is saved to localStorage per book. Re-upload any book and it picks up exactly where you stopped

### Organisation
- **Bookmarks** — tap the 🔖 button at any moment to save your position. Bookmarks panel shows chapter, page, and a text snippet. Jump back to any bookmark with one tap
- **Highlights** — double-click any word to highlight it in amber. All highlights are stored per book. Export your highlights as a `.txt` file with chapter and page context
- **Recent Books Library** — the last 5 books you opened are shown on the upload screen with their reading progress

### Listening Experience
- **Sleep Timer** — set playback to stop after 15, 30, or 60 minutes. Countdown shown in the player. Pauses cleanly without losing your position
- **Mini Player Bar** — sticky bar at the bottom of the screen when audio is playing or paused. Shows chapter, page number, and quick controls. Always visible while you scroll
- **PWA — Install to Home Screen** — BookVoice installs as a Progressive Web App on iOS and Android. Works like a native app
- **Lockscreen Controls** — control playback (play, pause, ±10s, next/prev chapter) from your phone's lockscreen or notification shade, exactly like Spotify or Audible

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 |
| PDF Parsing | pdfjs-dist 3.11.174 |
| EPUB Parsing | JSZip 3.10.1 |
| AI Voices | OpenAI TTS (`tts-1` model) |
| AI Summaries | OpenAI GPT-4o-mini |
| Browser Voice | Web Speech API (built-in, free) |
| Word Tracking | `timeupdate` event + `SpeechSynthesisUtterance.onboundary` |
| API Routes | Vercel Serverless Functions |
| PWA | Service Worker + Web App Manifest |
| Lockscreen | MediaSession API |
| Deployment | Vercel |
| Storage | localStorage (progress, bookmarks, highlights) |

---

## Getting Started

### Prerequisites
- Node.js 18+
- An OpenAI API key (for AI voices and summaries) — get one at [platform.openai.com](https://platform.openai.com/api-keys)

### Install

```bash
git clone https://github.com/aranotuchinedum2/bookvoice.git
cd bookvoice
npm install
```

### Environment Variables

Create a `.env.local` file in the root:

```env
OPENAI_API_KEY=sk-your-key-here
```

### Run Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

> Note: AI voices require the Vercel dev server for the API routes. For local testing of AI voices, run `npx vercel dev` instead of `npm run dev`.

### Build

```bash
npm run build
npm run preview
```

---

## Deploy to Vercel

### One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/aranotuchinedum2/bookvoice)

### Manual deploy

```bash
npx vercel login
npx vercel --prod
```

Then add your environment variable in the Vercel dashboard:

**Settings → Environment Variables → Add**
```
OPENAI_API_KEY = sk-your-key-here
```

Redeploy after adding the key.

---

## Project Structure

```
bookvoice/
├── api/
│   ├── tts.js          ← OpenAI TTS proxy (Vercel serverless)
│   └── summary.js      ← GPT-4o-mini chapter summary
├── public/
│   ├── sw.js           ← Service worker (PWA)
│   └── manifest.json   ← PWA manifest
├── src/
│   ├── App.jsx         ← Main app (all features)
│   └── main.jsx        ← React entry point
├── index.html
├── vite.config.js
├── vercel.json         ← Function timeout config
└── package.json
```

---

## How It Works

### PDF Parsing
BookVoice uses PDF.js to extract text from every page of the uploaded PDF. It then attempts to read the PDF's built-in outline (table of contents) to build chapter structure. If no outline exists, it uses regex pattern matching to detect chapter headings. If that fails too, it groups pages in sets of 10 as fallback chapters.

### EPUB Parsing
EPUBs are ZIP files. BookVoice extracts the OPF manifest, reads the spine order, and parses each HTML chapter file. Spine items are converted to text and split into pages for display.

### Audio Engine
Text is split into 500-character sentence-boundary chunks. Each chunk is sent to the OpenAI TTS API as a separate request. While one chunk plays, the next is being fetched in the background — this is why playback sounds seamless with no gaps. The HTML Audio element's `timeupdate` event fires every ~250ms and is used to estimate which word is being spoken, driving the word highlight.

### Click-to-Read
When you click a word, the app calculates that word's index in the page, builds new audio chunks starting from that word, and begins playback immediately. The active chunk and word index are tracked through refs (not state) to avoid React stale closure bugs in audio callbacks.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `←` | Previous page |
| `→` | Next page |
| `↑` | Previous chapter |
| `↓` | Next chapter |

---

## Voice Guide

| Voice | Character |
|---|---|
| Nova | Warm, natural female — great for fiction |
| Shimmer | Soft, clear female — good for non-fiction |
| Alloy | Neutral, balanced — works for everything |
| Echo | Male, natural — good for biographies |
| Fable | Expressive, storytelling tone |
| Onyx | Deep, authoritative male |
| Browser | Free, offline — uses your device's built-in voice |

---

## Cost Estimate (OpenAI)

| Feature | Model | Cost |
|---|---|---|
| AI Voice | `tts-1` | ~$0.015 per 1,000 characters |
| Chapter Summary | `gpt-4o-mini` | ~$0.0001 per summary |

A typical book chapter (~5,000 words) costs roughly **$0.10** in TTS. A full 80,000-word novel costs roughly **$1.60** total.

---

## Privacy

- All PDF and EPUB parsing happens entirely in your browser. Your book files are never uploaded to any server.
- Only the text chunks being narrated are sent to OpenAI's API. No file is stored server-side.
- Reading progress, bookmarks, and highlights are stored in your browser's localStorage only.

---

## License

MIT — use it, modify it, ship it.

---

## Acknowledgements

- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla
- [JSZip](https://stuk.github.io/jszip/) for EPUB parsing
- [OpenAI TTS](https://platform.openai.com/docs/guides/text-to-speech) for premium voices
- [Vercel](https://vercel.com) for seamless deployment

---

*This app was built by CeeJay for Chinedum Aranotu – 2026*
