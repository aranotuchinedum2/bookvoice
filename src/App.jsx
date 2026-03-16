// This app was built by CeeJay for Chinedum Aranotu – 2026
import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

export default function App() {
  const [screen, setScreen]         = useState('upload')
  const [loadMsg, setLoadMsg]       = useState('Processing book...')
  const [errMsg, setErrMsg]         = useState('')
  const [bookTitle, setBookTitle]   = useState('')
  const [chapters, setChapters]     = useState([])
  const [totalPages, setTotalPages] = useState(0)
  const [chIdx, setChIdx]           = useState(0)
  const [pgIdx, setPgIdx]           = useState(0)
  const [playing, setPlaying]       = useState(false)
  const [paused, setPaused]         = useState(false)
  const [rate, setRate]             = useState(1)
  const [spdIdx, setSpdIdx]         = useState(1)
  const [voice, setVoice]           = useState('nova')
  // activeWordIdx: index into the words array of the current page being highlighted
  const [activeWordIdx, setActiveWordIdx] = useState(-1)
  const speeds = [0.75, 1, 1.25, 1.5, 2]
  const synth  = window.speechSynthesis

  // Audio refs
  const audioRef       = useRef(null)
  const nextAudioRef   = useRef(null)
  const chunksRef      = useRef([])
  const chunkIdxRef    = useRef(0)
  // Track char offset of the start of the current chunk within the full page text
  const chunkOffsetRef = useRef(0)

  // Stable refs
  const chIdxRef    = useRef(chIdx)
  const pgIdxRef    = useRef(pgIdx)
  const chaptersRef = useRef(chapters)
  const rateRef     = useRef(rate)
  const voiceRef    = useRef(voice)
  const playingRef  = useRef(false)
  const pausedRef   = useRef(false)

  useEffect(() => { chIdxRef.current    = chIdx },    [chIdx])
  useEffect(() => { pgIdxRef.current    = pgIdx },    [pgIdx])
  useEffect(() => { chaptersRef.current = chapters }, [chapters])
  useEffect(() => { rateRef.current     = rate },     [rate])
  useEffect(() => { voiceRef.current    = voice },    [voice])

  // Save reading progress
  useEffect(() => {
    if (!bookTitle || !chapters.length) return
    const key = `bookvoice_${bookTitle.replace(/\s+/g, '_')}`
    localStorage.setItem(key, JSON.stringify({ chIdx, pgIdx, timestamp: Date.now() }))
  }, [chIdx, pgIdx, bookTitle])

  // ─── Progress ─────────────────────────────────────────────────────────────
  const loadProgress = (title, chs) => {
    try {
      const saved = localStorage.getItem(`bookvoice_${title.replace(/\s+/g, '_')}`)
      if (!saved) return { chIdx: 0, pgIdx: 0 }
      const { chIdx: c, pgIdx: p } = JSON.parse(saved)
      if (c >= chs.length) return { chIdx: 0, pgIdx: 0 }
      if (p >= chs[c].pages.length) return { chIdx: c, pgIdx: 0 }
      return { chIdx: c, pgIdx: p }
    } catch { return { chIdx: 0, pgIdx: 0 } }
  }

  // ─── File handler ──────────────────────────────────────────────────────────
  const handle = async (file) => {
    const ext   = file.name.split('.').pop().toLowerCase()
    const title = file.name.replace(/\.(pdf|epub)$/i, '')
    setBookTitle(title); setScreen('loading')
    try {
      let result
      if (ext === 'pdf')       result = await parsePDF(file)
      else if (ext === 'epub') result = await parseEPUB(file)
      else throw new Error('Please upload a PDF or EPUB file.')
      if (!result.chapters.length) throw new Error('No readable content found.')
      setChapters(result.chapters); setTotalPages(result.totalPages)
      const { chIdx: c, pgIdx: p } = loadProgress(title, result.chapters)
      setChIdx(c); setPgIdx(p); chIdxRef.current = c; pgIdxRef.current = p
      setScreen('player')
    } catch (e) {
      setErrMsg(e.message); setScreen('error')
      setTimeout(() => setScreen('upload'), 3000)
    }
  }

  // ─── PDF parser ────────────────────────────────────────────────────────────
  const parsePDF = async (file) => {
    setLoadMsg('Loading PDF...')
    const buf = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    const allPages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      if (i % 10 === 0) setLoadMsg(`Reading page ${i} of ${pdf.numPages}...`)
      const page = await pdf.getPage(i)
      const tc   = await page.getTextContent()
      let lastY  = null, text = ''
      for (const item of tc.items) {
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 8) text += '\n'
        text += item.str; lastY = item.transform[5]
      }
      const trimmed = text.trim()
      if (trimmed.length > 20) allPages.push({ n: i, text: trimmed })
    }
    setLoadMsg('Detecting chapters...')
    let chs = []
    try {
      const outline = await pdf.getOutline()
      if (outline?.length) chs = await chaptersFromOutline(pdf, outline, allPages)
    } catch (_) {}
    if (!chs.length) chs = autoDetect(allPages)
    return { chapters: chs.filter(c => c.pages.length > 0), totalPages: pdf.numPages }
  }

  const chaptersFromOutline = async (pdf, outline, allPages) => {
    const flat = []
    const flatten = (items) => items.forEach(it => { flat.push(it); if (it.items?.length) flatten(it.items) })
    flatten(outline)
    const result = []
    for (const it of flat) {
      try {
        let dest = it.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (!dest) continue
        const idx = await pdf.getPageIndex(dest[0])
        result.push({ title: it.title || `Section ${result.length + 1}`, startPage: idx + 1 })
      } catch (_) {}
    }
    result.sort((a, b) => a.startPage - b.startPage)
    return result.map((ch, i) => {
      const end   = i < result.length - 1 ? result[i + 1].startPage - 1 : allPages.length
      const pages = allPages.filter(p => p.n >= ch.startPage && p.n <= end).map(p => p.text).filter(t => t.length > 40)
      return { ...ch, endPage: end, pages }
    })
  }

  const autoDetect = (allPages) => {
    const RE = [
      /^chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
      /^part\s+(\d+|[ivxlcdm]+)/i,
      /^(prologue|epilogue|introduction|preface|foreword|appendix|afterword|conclusion)/i,
    ]
    const chs = []; let cur = null
    for (const pg of allPages) {
      const first   = pg.text.split('\n')[0]?.trim() || ''
      const isStart = RE.some(r => r.test(first))
      if (isStart || !cur) {
        if (cur) chs.push(cur)
        cur = { title: isStart ? first.slice(0, 70) : 'Beginning', startPage: pg.n, endPage: pg.n, pages: [] }
      }
      cur.endPage = pg.n
      if (pg.text.length > 40) cur.pages.push(pg.text)
    }
    if (cur) chs.push(cur)
    if (chs.length <= 1) {
      return Array.from({ length: Math.ceil(allPages.length / 10) }, (_, i) => {
        const g = allPages.slice(i * 10, i * 10 + 10)
        return { title: `Pages ${g[0].n}–${g[g.length-1].n}`, startPage: g[0].n, endPage: g[g.length-1].n, pages: g.map(p => p.text).filter(t => t.length > 20) }
      })
    }
    return chs
  }

  // ─── EPUB parser ───────────────────────────────────────────────────────────
  const parseEPUB = async (file) => {
    setLoadMsg('Loading EPUB...')
    const JSZip  = (await import('jszip')).default
    const buf    = await file.arrayBuffer()
    const zip    = await JSZip.loadAsync(buf)
    const cXml   = await zip.file('META-INF/container.xml')?.async('string')
    if (!cXml) throw new Error('Invalid EPUB file')
    const opfPath = cXml.match(/full-path="([^"]+\.opf)"/)?.[1]
    if (!opfPath) throw new Error('Cannot find OPF')
    const opfDir  = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''
    const opfTxt  = await zip.file(opfPath)?.async('string')
    if (!opfTxt) throw new Error('Cannot read OPF')
    const parser = new DOMParser()
    const opf    = parser.parseFromString(opfTxt, 'application/xml')
    const mf     = {}
    opf.querySelectorAll('manifest item').forEach(el => {
      mf[el.getAttribute('id')] = { href: opfDir + el.getAttribute('href'), type: el.getAttribute('media-type') }
    })
    const spine = []
    opf.querySelectorAll('spine itemref').forEach(ref => { const id = ref.getAttribute('idref'); if (mf[id]) spine.push(mf[id]) })
    const chs = []; let pgCtr = 1
    for (let i = 0; i < spine.length; i++) {
      const item = spine[i]
      if (!item.type?.includes('html')) continue
      setLoadMsg(`Reading chapter ${i + 1} of ${spine.length}...`)
      const html = await zip.file(item.href)?.async('string')
      if (!html) continue
      const doc  = parser.parseFromString(html, 'text/html')
      doc.querySelectorAll('script,style,nav,aside').forEach(el => el.remove())
      const chTitle = doc.querySelector('h1,h2,h3')?.textContent?.trim() || `Chapter ${i + 1}`
      const fullTxt = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || ''
      if (fullTxt.length < 80) continue
      const words = fullTxt.split(' '); const pgTxts = []; let cur = ''
      for (const w of words) {
        if ((cur + ' ' + w).length > 2000 && cur) { pgTxts.push(cur.trim()); cur = w }
        else cur += (cur ? ' ' : '') + w
      }
      if (cur.trim()) pgTxts.push(cur.trim())
      chs.push({ title: chTitle.slice(0, 80), startPage: pgCtr, endPage: pgCtr + pgTxts.length - 1, pages: pgTxts })
      pgCtr += pgTxts.length
    }
    return { chapters: chs, totalPages: pgCtr - 1 }
  }

  // ─── Chunk text at sentence boundaries ────────────────────────────────────
  // Returns array of { text, charOffset } so we can map chunks back to char positions
  const makeChunks = (fullText) => {
    const chunks    = []
    const sentences = fullText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [fullText]
    let chunk = '', offset = 0, chunkStart = 0
    for (const s of sentences) {
      if ((chunk + s).length > 500 && chunk) {
        chunks.push({ text: chunk.trim(), charOffset: chunkStart })
        chunkStart = offset
        chunk = s
      } else {
        chunk += s
      }
      offset += s.length
    }
    if (chunk.trim()) chunks.push({ text: chunk.trim(), charOffset: chunkStart })
    return chunks
  }

  // ─── Pre-fetch audio in background ────────────────────────────────────────
  const prefetchChunk = async (text) => {
    if (!text) return null
    try {
      const res = await fetch('/api/tts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text, voice: voiceRef.current, speed: rateRef.current }),
      })
      if (!res.ok) return null
      return URL.createObjectURL(await res.blob())
    } catch { return null }
  }

  // ─── Advance to next page after all chunks done ───────────────────────────
  const advancePage = () => {
    setActiveWordIdx(-1)
    const chs = chaptersRef.current
    const ci  = chIdxRef.current
    const pi  = pgIdxRef.current
    const ch  = chs[ci]
    if (pi < ch.pages.length - 1) {
      const nextPg = pi + 1
      setPgIdx(nextPg); pgIdxRef.current = nextPg
      startChunksFromChar(ch.pages[nextPg], 0)
    } else if (ci < chs.length - 1) {
      const nextCh = ci + 1
      setChIdx(nextCh); setPgIdx(0); chIdxRef.current = nextCh; pgIdxRef.current = 0
      startChunksFromChar(chs[nextCh].pages[0], 0)
    } else {
      setPlaying(false); setPaused(false)
      playingRef.current = false; pausedRef.current = false
    }
  }

  // ─── Core: play chunks from a given index ─────────────────────────────────
  const playChunks = async (chunks, startIdx) => {
    if (startIdx >= chunks.length) { advancePage(); return }

    chunkIdxRef.current  = startIdx
    chunkOffsetRef.current = chunks[startIdx].charOffset

    // Highlight the first word of this chunk in the UI
    const fullText = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current] || ''
    highlightWordAtChar(fullText, chunks[startIdx].charOffset)

    let url = nextAudioRef.current
    nextAudioRef.current = null
    if (!url) url = await prefetchChunk(chunks[startIdx].text)

    if (!url) { readPageBrowser(chIdxRef.current, pgIdxRef.current); return }

    // Pre-fetch NEXT chunk while this one plays — eliminates gaps
    if (startIdx + 1 < chunks.length) {
      prefetchChunk(chunks[startIdx + 1].text).then(u => { nextAudioRef.current = u })
    }

    if (audioRef.current) {
      audioRef.current.onended = null; audioRef.current.onerror = null
      audioRef.current.pause(); audioRef.current = null
    }

    const audio = new Audio(url)
    audioRef.current   = audio
    audio.playbackRate = rateRef.current

    audio.onended = () => {
      URL.revokeObjectURL(url)
      if (playingRef.current && !pausedRef.current) playChunks(chunks, startIdx + 1)
    }
    audio.onerror = () => {
      setPlaying(false); playingRef.current = false
      readPageBrowser(chIdxRef.current, pgIdxRef.current)
    }

    audio.play()
    setPlaying(true); setPaused(false)
    playingRef.current = true; pausedRef.current = false
  }

  // ─── Start from a specific character offset in the page text ──────────────
  const startChunksFromChar = (fullText, charOffset) => {
    const chunks = makeChunks(fullText)
    chunksRef.current = chunks
    if (nextAudioRef.current) { URL.revokeObjectURL(nextAudioRef.current); nextAudioRef.current = null }

    // Find the chunk that contains charOffset
    let startIdx = 0
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunks[i].charOffset <= charOffset) { startIdx = i; break }
    }
    playChunks(chunks, startIdx)
  }

  // ─── Highlight word at a character position ────────────────────────────────
  const highlightWordAtChar = (fullText, charOffset) => {
    const words = fullText.split(/\s+/)
    let pos = 0, idx = 0
    for (let i = 0; i < words.length; i++) {
      if (pos >= charOffset) { idx = i; break }
      pos += words[i].length + 1
      idx = i
    }
    setActiveWordIdx(idx)
  }

  // ─── Click a word → read from that word ───────────────────────────────────
  const handleWordClick = (wordIdx, words) => {
    // Calculate char offset of this word in the full page text
    let charOffset = 0
    for (let i = 0; i < wordIdx; i++) charOffset += words[i].length + 1
    setActiveWordIdx(wordIdx)
    stopAll()
    const fullText = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current]
    if (!fullText) return
    if (voiceRef.current === 'browser') {
      // For browser voice, read from this word onwards
      const remainingText = words.slice(wordIdx).join(' ')
      readTextBrowser(remainingText)
    } else {
      startChunksFromChar(fullText, charOffset)
    }
  }

  // ─── +10 / -10 second skip ─────────────────────────────────────────────────
  const skipSeconds = (secs) => {
    if (audioRef.current) {
      // OpenAI audio — seek within current Audio element
      const newTime = audioRef.current.currentTime + secs
      if (newTime < 0) {
        audioRef.current.currentTime = 0
      } else if (newTime >= audioRef.current.duration) {
        // Skip past end of chunk — advance to next chunk
        audioRef.current.onended?.()
      } else {
        audioRef.current.currentTime = newTime
      }
    } else if (synth.speaking) {
      // Browser voice — can't seek natively, so we restart
      // from approximately the right word based on estimated reading speed
      const wpm      = 150 * rateRef.current
      const elapsed  = secs > 0
        ? (audioRef.current?.currentTime || 0) + secs
        : Math.max(0, (audioRef.current?.currentTime || 0) + secs)
      const wordsSkip = Math.round((wpm / 60) * Math.abs(secs)) * (secs > 0 ? 1 : -1)
      const fullText  = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current] || ''
      const words     = fullText.split(/\s+/)
      const newIdx    = Math.max(0, Math.min(words.length - 1, activeWordIdx + wordsSkip))
      handleWordClick(newIdx, words)
    }
  }

  // ─── Browser TTS ──────────────────────────────────────────────────────────
  const readPageBrowser = (chI, pgI) => {
    const text = chaptersRef.current[chI]?.pages[pgI]
    if (!text?.trim()) return
    readTextBrowser(text)
  }

  const readTextBrowser = (text) => {
    synth.cancel()
    const u   = new SpeechSynthesisUtterance(text)
    u.rate    = rateRef.current
    u.onstart = () => { setPlaying(true); setPaused(false); playingRef.current = true }
    u.onboundary = (e) => {
      if (e.name === 'word') {
        const fullText = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current] || ''
        highlightWordAtChar(fullText, e.charIndex)
      }
    }
    u.onend = () => {
      const chs = chaptersRef.current; const ci = chIdxRef.current; const pi = pgIdxRef.current
      if (pi < chs[ci].pages.length - 1) {
        const next = pi + 1; setPgIdx(next); pgIdxRef.current = next; readPageBrowser(ci, next)
      } else if (ci < chs.length - 1) {
        const nc = ci + 1; setChIdx(nc); setPgIdx(0); chIdxRef.current = nc; pgIdxRef.current = 0; readPageBrowser(nc, 0)
      } else { setPlaying(false); playingRef.current = false; setActiveWordIdx(-1) }
    }
    u.onerror = (e) => { if (e.error !== 'interrupted') { setPlaying(false); playingRef.current = false } }
    synth.speak(u)
  }

  // ─── Stop everything ──────────────────────────────────────────────────────
  const stopAll = () => {
    if (audioRef.current) {
      audioRef.current.onended = null; audioRef.current.onerror = null
      audioRef.current.pause(); audioRef.current = null
    }
    if (nextAudioRef.current) { URL.revokeObjectURL(nextAudioRef.current); nextAudioRef.current = null }
    synth.cancel()
    setPlaying(false); setPaused(false)
    playingRef.current = false; pausedRef.current = false
    chunksRef.current  = []; chunkIdxRef.current = 0; chunkOffsetRef.current = 0
    setActiveWordIdx(-1)
  }

  // ─── Play / Pause / Resume ─────────────────────────────────────────────────
  const togglePlay = () => {
    if (playing) {
      if (audioRef.current) audioRef.current.pause()
      synth.pause()
      setPlaying(false); setPaused(true)
      playingRef.current = false; pausedRef.current = true
    } else if (paused) {
      pausedRef.current = false; setPaused(false)
      if (audioRef.current) {
        audioRef.current.play(); setPlaying(true); playingRef.current = true
      } else if (voiceRef.current === 'browser') {
        synth.resume(); setPlaying(true); playingRef.current = true
      } else {
        const chunks = chunksRef.current; const idx = chunkIdxRef.current
        if (chunks.length && idx < chunks.length) playChunks(chunks, idx)
        else { const t = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current]; if (t) startChunksFromChar(t, 0) }
      }
    } else {
      const text = chapters[chIdx]?.pages[pgIdx]
      if (!text) return
      if (voiceRef.current === 'browser') readPageBrowser(chIdx, pgIdx)
      else startChunksFromChar(text, 0)
    }
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  const prevPage = () => {
    stopAll()
    if (pgIdx > 0) { const p = pgIdx - 1; setPgIdx(p); pgIdxRef.current = p }
    else if (chIdx > 0) {
      const c = chIdx - 1; const p = chapters[c].pages.length - 1
      setChIdx(c); setPgIdx(p); chIdxRef.current = c; pgIdxRef.current = p
    }
  }
  const nextPage = () => {
    stopAll()
    const ch = chapters[chIdx]
    if (pgIdx < ch.pages.length - 1) { const p = pgIdx + 1; setPgIdx(p); pgIdxRef.current = p }
    else if (chIdx < chapters.length - 1) { const c = chIdx + 1; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 }
  }
  const prevChapter = () => {
    stopAll()
    if (chIdx > 0) { const c = chIdx - 1; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 }
  }
  const nextChapter = () => {
    stopAll()
    if (chIdx < chapters.length - 1) { const c = chIdx + 1; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 }
  }
  const cycleSpeed = () => {
    const next = (spdIdx + 1) % speeds.length; const newRate = speeds[next]
    setSpdIdx(next); setRate(newRate); rateRef.current = newRate
    if (audioRef.current) audioRef.current.playbackRate = newRate
  }

  const ch = chapters[chIdx]

  // ─── Render page text as clickable words ──────────────────────────────────
  const renderPageText = (text) => {
    if (!text) return null
    const words = text.split(/(\s+)/)
    let wordIdx = 0
    return words.map((token, i) => {
      if (/^\s+$/.test(token)) return <span key={i}>{token}</span>
      const idx = wordIdx++
      const isActive = idx === activeWordIdx
      return (
        <span
          key={i}
          onClick={() => handleWordClick(idx, text.split(/\s+/))}
          style={{
            cursor:        'pointer',
            background:    isActive ? '#BA7517' : 'transparent',
            color:         isActive ? '#fff' : 'inherit',
            borderRadius:  isActive ? '3px' : '0',
            padding:       isActive ? '0 2px' : '0',
            transition:    'background 0.15s',
          }}
        >
          {token}
        </span>
      )
    })
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>

      {/* UPLOAD */}
      {screen === 'upload' && (
        <div>
          <h2 style={{ marginBottom: 8 }}>BookVoice</h2>
          <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>Drop a PDF or EPUB — listen on the go</p>
          <label style={{ display: 'block', border: '2px dashed #ddd', borderRadius: 12, padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Drop your book here</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>PDF or EPUB supported</div>
            <span style={{ padding: '8px 24px', background: '#BA7517', color: '#fff', borderRadius: 40, fontSize: 14 }}>Choose file</span>
            <input type="file" accept=".pdf,.epub" style={{ display: 'none' }}
              onChange={e => e.target.files[0] && handle(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* LOADING */}
      {screen === 'loading' && (
        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #eee', borderTopColor: '#BA7517', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
          <p style={{ color: '#666', fontSize: 14 }}>{loadMsg}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ERROR */}
      {screen === 'error' && (
        <div style={{ color: 'red', textAlign: 'center', padding: '2rem' }}>{errMsg}</div>
      )}

      {/* PLAYER */}
      {screen === 'player' && ch && (
        <div>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
            <div style={{ flex: 1, fontWeight: 500, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookTitle}</div>
            <button onClick={() => { stopAll(); setScreen('upload') }}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: 'none', cursor: 'pointer' }}>
              + New book
            </button>
          </div>

          {/* Chapter selector */}
          <select value={chIdx}
            onChange={e => { stopAll(); const c = +e.target.value; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 16, background: '#fff' }}>
            {chapters.map((c, i) => <option key={i} value={i}>{c.title}</option>)}
          </select>

          {/* Page text — clickable words */}
          <div style={{ background: '#fdf8f0', border: '1px solid #f0e0c0', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 16, maxHeight: 280, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontFamily: 'monospace' }}>
              Page {ch.startPage + pgIdx} of {ch.endPage}
              {activeWordIdx >= 0 && (
                <span style={{ marginLeft: 8, color: '#BA7517' }}>● tap any word to read from there</span>
              )}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.9, color: '#222', userSelect: 'none' }}>
              {renderPageText(ch.pages[pgIdx])}
            </div>
          </div>

          {/* Hint when not playing */}
          {!playing && !paused && (
            <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginBottom: 10 }}>
              Tap any word in the text to start reading from there
            </div>
          )}

          {/* Voice picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Voice:</label>
            <select value={voice}
              onChange={e => { stopAll(); setVoice(e.target.value); voiceRef.current = e.target.value }}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd', background: '#fff' }}>
              <option value="nova">Nova (warm female)</option>
              <option value="shimmer">Shimmer (soft female)</option>
              <option value="alloy">Alloy (neutral)</option>
              <option value="echo">Echo (male)</option>
              <option value="fable">Fable (expressive)</option>
              <option value="onyx">Onyx (deep male)</option>
              <option value="browser">Browser (free, offline)</option>
            </select>
            <span style={{ fontSize: 11, color: voice === 'browser' ? '#888' : '#3a3' }}>
              {voice === 'browser' ? '● Browser' : '● AI voice'}
            </span>
          </div>

          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>

            {/* Prev chapter */}
            <button onClick={prevChapter} style={btnStyle} title="Prev chapter">⏮</button>

            {/* Prev page */}
            <button onClick={prevPage} style={btnStyle} title="Prev page">◀</button>

            {/* -10s */}
            <button onClick={() => skipSeconds(-10)} style={btnStyle} title="Back 10s">
              <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1 }}>-10s</span>
            </button>

            {/* Play / Pause */}
            <button onClick={togglePlay}
              style={{ ...btnStyle, width: 52, height: 52, background: '#BA7517', color: '#fff', border: 'none', fontSize: 20 }}>
              {playing ? '⏸' : '▶'}
            </button>

            {/* +10s */}
            <button onClick={() => skipSeconds(10)} style={btnStyle} title="Forward 10s">
              <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1 }}>+10s</span>
            </button>

            {/* Next page */}
            <button onClick={nextPage} style={btnStyle} title="Next page">▶</button>

            {/* Next chapter */}
            <button onClick={nextChapter} style={btnStyle} title="Next chapter">⏭</button>

            {/* Speed */}
            <button onClick={cycleSpeed}
              style={{ ...btnStyle, fontFamily: 'monospace', fontSize: 12, padding: '0 12px', width: 'auto' }}>
              {rate}×
            </button>

          </div>

          {/* Status */}
          <div style={{ textAlign: 'center', fontSize: 12, color: '#999' }}>
            {playing ? '▶ Reading...' : paused ? '⏸ Paused' : 'Ready'}
            {' '}— {chapters.length} chapters · {totalPages} pages
          </div>

          {/* Signature */}
          <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid #eee', textAlign: 'center', fontSize: 11, color: '#bbb' }}>
            This app was built by CeeJay for Chinedum Aranotu – 2026
          </div>

        </div>
      )}
    </div>
  )
}

const btnStyle = {
  width: 38, height: 38, borderRadius: '50%', border: '1px solid #ddd',
  background: '#fff', cursor: 'pointer', fontSize: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
