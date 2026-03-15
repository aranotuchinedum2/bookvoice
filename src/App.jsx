// This app was built by CeeJay for Chinedum Aranotu – 2026
import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

export default function App() {
  const [screen, setScreen]       = useState('upload')
  const [loadMsg, setLoadMsg]     = useState('Processing book...')
  const [errMsg, setErrMsg]       = useState('')
  const [bookTitle, setBookTitle] = useState('')
  const [chapters, setChapters]   = useState([])
  const [totalPages, setTotalPages] = useState(0)
  const [chIdx, setChIdx]         = useState(0)
  const [pgIdx, setPgIdx]         = useState(0)
  const [playing, setPlaying]     = useState(false)
  const [rate, setRate]           = useState(1)
  const [spdIdx, setSpdIdx]       = useState(1)
  const [voice, setVoice]         = useState('nova')
  const [useOpenAI, setUseOpenAI] = useState(true)
  const speeds   = [0.75, 1, 1.25, 1.5, 2]
  const synth    = window.speechSynthesis
  const audioRef = useRef(null)

  // Use refs to avoid stale closures inside audio callbacks
  const chIdxRef   = useRef(chIdx)
  const pgIdxRef   = useRef(pgIdx)
  const chaptersRef = useRef(chapters)
  const rateRef    = useRef(rate)
  const voiceRef   = useRef(voice)

  useEffect(() => { chIdxRef.current = chIdx }, [chIdx])
  useEffect(() => { pgIdxRef.current = pgIdx }, [pgIdx])
  useEffect(() => { chaptersRef.current = chapters }, [chapters])
  useEffect(() => { rateRef.current = rate }, [rate])
  useEffect(() => { voiceRef.current = voice }, [voice])

  // Save reading progress whenever chapter/page changes
  useEffect(() => {
    if (!bookTitle || !chapters.length) return
    const key = `bookvoice_${bookTitle.replace(/\s+/g, '_')}`
    localStorage.setItem(key, JSON.stringify({ chIdx, pgIdx, timestamp: Date.now() }))
  }, [chIdx, pgIdx, bookTitle])

  // ─── Load progress from localStorage ───────────────────────────────────────
  const loadProgress = (title, chs) => {
    try {
      const key   = `bookvoice_${title.replace(/\s+/g, '_')}`
      const saved = localStorage.getItem(key)
      if (!saved) return { chIdx: 0, pgIdx: 0 }
      const { chIdx: c, pgIdx: p } = JSON.parse(saved)
      if (c >= chs.length) return { chIdx: 0, pgIdx: 0 }
      if (p >= chs[c].pages.length) return { chIdx: c, pgIdx: 0 }
      return { chIdx: c, pgIdx: p }
    } catch {
      return { chIdx: 0, pgIdx: 0 }
    }
  }

  // ─── File handler ───────────────────────────────────────────────────────────
  const handle = async (file) => {
    const ext   = file.name.split('.').pop().toLowerCase()
    const title = file.name.replace(/\.(pdf|epub)$/i, '')   // ← title defined here
    setBookTitle(title)
    setScreen('loading')
    try {
      let result
      if (ext === 'pdf')        result = await parsePDF(file)
      else if (ext === 'epub')  result = await parseEPUB(file)
      else throw new Error('Please upload a PDF or EPUB file.')
      if (!result.chapters.length) throw new Error('No readable content found.')
      setChapters(result.chapters)
      setTotalPages(result.totalPages)
      const { chIdx: savedCh, pgIdx: savedPg } = loadProgress(title, result.chapters)
      setChIdx(savedCh)
      setPgIdx(savedPg)
      setScreen('player')
    } catch (e) {
      setErrMsg(e.message)
      setScreen('error')
      setTimeout(() => setScreen('upload'), 3000)
    }
  }

  // ─── PDF parser ─────────────────────────────────────────────────────────────
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
        text  += item.str
        lastY  = item.transform[5]
      }
      const trimmed = text.trim()
      // Split long pages into ~500 char chunks
      if (trimmed.length > 500) {
        const words = trimmed.split(' ')
        let chunk = ''
        let subIdx = 0
        for (const w of words) {
          if ((chunk + ' ' + w).length > 500 && chunk) {
            allPages.push({ n: i + subIdx * 0.001, text: chunk.trim() })
            chunk = w; subIdx++
          } else {
            chunk += (chunk ? ' ' : '') + w
          }
        }
        if (chunk.trim()) allPages.push({ n: i + subIdx * 0.001, text: chunk.trim() })
      } else if (trimmed.length > 20) {
        allPages.push({ n: i, text: trimmed })
      }
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
    const flatten = (items) =>
      items.forEach(it => { flat.push(it); if (it.items?.length) flatten(it.items) })
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
      const pages = allPages
        .filter(p => p.n >= ch.startPage && p.n <= end)
        .map(p => p.text)
        .filter(t => t.length > 40)
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
        return {
          title: `Pages ${g[0].n}–${g[g.length - 1].n}`,
          startPage: g[0].n,
          endPage:   g[g.length - 1].n,
          pages:     g.map(p => p.text).filter(t => t.length > 20),
        }
      })
    }
    return chs
  }

  // ─── EPUB parser ─────────────────────────────────────────────────────────────
  const parseEPUB = async (file) => {
    setLoadMsg('Loading EPUB...')
    const JSZip  = (await import('jszip')).default
    const buf    = await file.arrayBuffer()
    const zip    = await JSZip.loadAsync(buf)
    const cXml   = await zip.file('META-INF/container.xml')?.async('string')
    if (!cXml) throw new Error('Invalid EPUB file')
    const opfPath = cXml.match(/full-path="([^"]+\.opf)"/)?.[1]
    if (!opfPath) throw new Error('Cannot find OPF')
    const opfDir  = opfPath.includes('/')
      ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
      : ''
    const opfTxt  = await zip.file(opfPath)?.async('string')
    if (!opfTxt) throw new Error('Cannot read OPF')

    const parser = new DOMParser()
    const opf    = parser.parseFromString(opfTxt, 'application/xml')
    const mf     = {}
    opf.querySelectorAll('manifest item').forEach(el => {
      mf[el.getAttribute('id')] = {
        href: opfDir + el.getAttribute('href'),
        type: el.getAttribute('media-type'),
      }
    })

    const spine = []
    opf.querySelectorAll('spine itemref').forEach(ref => {
      const id = ref.getAttribute('idref')
      if (mf[id]) spine.push(mf[id])
    })

    const chs = []; let pgCtr = 1
    for (let i = 0; i < spine.length; i++) {
      const item = spine[i]
      if (!item.type?.includes('html')) continue
      setLoadMsg(`Reading chapter ${i + 1} of ${spine.length}...`)
      const html = await zip.file(item.href)?.async('string')
      if (!html) continue
      const doc  = parser.parseFromString(html, 'text/html')
      doc.querySelectorAll('script,style,nav,aside').forEach(el => el.remove())
      const chTitle  = doc.querySelector('h1,h2,h3')?.textContent?.trim() || `Chapter ${i + 1}`
      const fullTxt  = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || ''
      if (fullTxt.length < 80) continue
      const words  = fullTxt.split(' ')
      const pgTxts = []
      let cur = ''
      for (const w of words) {
        if ((cur + ' ' + w).length > 500 && cur) { pgTxts.push(cur.trim()); cur = w }
        else cur += (cur ? ' ' : '') + w
      }
      if (cur.trim()) pgTxts.push(cur.trim())
      chs.push({
        title:     chTitle.slice(0, 80),
        startPage: pgCtr,
        endPage:   pgCtr + pgTxts.length - 1,
        pages:     pgTxts,
      })
      pgCtr += pgTxts.length
    }
    return { chapters: chs, totalPages: pgCtr - 1 }
  }

  // ─── OpenAI TTS (uses refs to avoid stale closures) ──────────────────────────
  const speakWithOpenAI = async (text, spd) => {
    const trimmed = text.length > 800
      ? text.substring(0, 800).replace(/\s+\S*$/, '') + '...'
      : text

    try {
      const res = await fetch('/api/tts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: trimmed, voice: voiceRef.current, speed: spd }),
      })
      if (!res.ok) {
        const errText = await res.text()
        alert('TTS failed: ' + errText)
        throw new Error(errText)
      }

      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
        audioRef.current = null
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.play()
      setPlaying(true)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        const currentChs   = chaptersRef.current
        const currentChIdx = chIdxRef.current
        const currentPgIdx = pgIdxRef.current
        const currentCh    = currentChs[currentChIdx]

        if (currentPgIdx < currentCh.pages.length - 1) {
          const nextPg = currentPgIdx + 1
          setPgIdx(nextPg)
          speakWithOpenAI(currentCh.pages[nextPg], rateRef.current)
        } else if (currentChIdx < currentChs.length - 1) {
          const nextCh = currentChIdx + 1
          setChIdx(nextCh)
          setPgIdx(0)
          speakWithOpenAI(currentChs[nextCh].pages[0], rateRef.current)
        } else {
          setPlaying(false)
        }
      }

      audio.onerror = () => {
        setPlaying(false)
        setUseOpenAI(false)
        readPage(chIdxRef.current, pgIdxRef.current)
      }

    } catch (e) {
      alert('TTS Error: ' + e.message)
      console.warn('OpenAI TTS failed, falling back to browser voice:', e)
      setUseOpenAI(false)
      readPage(chIdxRef.current, pgIdxRef.current)
    }
  }

  // ─── Browser TTS fallback ────────────────────────────────────────────────────
  const readPage = (chI, pgI) => {
    synth.cancel()
    const ch = chaptersRef.current[chI]
    if (!ch) return
    const text = ch.pages[pgI]
    if (!text?.trim()) { nextPage(); return }
    const u  = new SpeechSynthesisUtterance(text)
    u.rate   = rateRef.current
    u.onstart = () => setPlaying(true)
    u.onend   = () => {
      const currentChs   = chaptersRef.current
      const currentChIdx = chIdxRef.current
      const currentPgIdx = pgIdxRef.current
      if (currentPgIdx < currentChs[currentChIdx].pages.length - 1) {
        const next = currentPgIdx + 1
        setPgIdx(next); readPage(currentChIdx, next)
      } else if (currentChIdx < currentChs.length - 1) {
        const nextCh = currentChIdx + 1
        setChIdx(nextCh); setPgIdx(0); readPage(nextCh, 0)
      } else {
        setPlaying(false)
      }
    }
    u.onerror = (e) => { if (e.error !== 'interrupted') setPlaying(false) }
    synth.speak(u)
  }

  // ─── Playback controls ───────────────────────────────────────────────────────
  const stopAll = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    synth.cancel()
    setPlaying(false)
  }

  const togglePlay = () => {
    if (playing) {
      stopAll()
    } else {
      const text = chapters[chIdx]?.pages[pgIdx]
      if (!text) return
      if (useOpenAI) speakWithOpenAI(text, rate)
      else readPage(chIdx, pgIdx)
    }
  }

  const prevPage = () => {
    stopAll()
    if (pgIdx > 0) setPgIdx(p => p - 1)
    else if (chIdx > 0) { setChIdx(c => c - 1); setPgIdx(chapters[chIdx - 1].pages.length - 1) }
  }

  const nextPage = () => {
    stopAll()
    const ch = chapters[chIdx]
    if (pgIdx < ch.pages.length - 1) setPgIdx(p => p + 1)
    else if (chIdx < chapters.length - 1) { setChIdx(c => c + 1); setPgIdx(0) }
  }

  const prevChapter = () => {
    stopAll()
    if (chIdx > 0) { setChIdx(c => c - 1); setPgIdx(0) }
  }

  const nextChapter = () => {
    stopAll()
    if (chIdx < chapters.length - 1) { setChIdx(c => c + 1); setPgIdx(0) }
  }

  const cycleSpeed = () => {
    const next = (spdIdx + 1) % speeds.length
    setSpdIdx(next); setRate(speeds[next])
    stopAll()
  }

  const ch = chapters[chIdx]

  // ─── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── UPLOAD SCREEN ── */}
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

      {/* ── LOADING SCREEN ── */}
      {screen === 'loading' && (
        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #eee', borderTopColor: '#BA7517', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
          <p style={{ color: '#666', fontSize: 14 }}>{loadMsg}</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ── ERROR SCREEN ── */}
      {screen === 'error' && (
        <div style={{ color: 'red', textAlign: 'center', padding: '2rem' }}>{errMsg}</div>
      )}

      {/* ── PLAYER SCREEN ── */}
      {screen === 'player' && ch && (
        <div>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
            <div style={{ flex: 1, fontWeight: 500, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bookTitle}
            </div>
            <button onClick={() => { stopAll(); setScreen('upload') }}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: 'none', cursor: 'pointer' }}>
              + New book
            </button>
          </div>

          {/* Chapter selector */}
          <select value={chIdx}
            onChange={e => { stopAll(); setChIdx(+e.target.value); setPgIdx(0) }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 16, background: '#fff' }}>
            {chapters.map((c, i) => <option key={i} value={i}>{c.title}</option>)}
          </select>

          {/* Page content */}
          <div style={{ background: '#fdf8f0', border: '1px solid #f0e0c0', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontFamily: 'monospace' }}>
              Page {ch.startPage + pgIdx} of {ch.endPage}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222' }}>
              {ch.pages[pgIdx]}
            </div>
          </div>

          {/* Voice picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Voice:</label>
            <select value={voice} onChange={e => { setVoice(e.target.value); stopAll() }}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd', background: '#fff' }}>
              <option value="nova">Nova (warm female)</option>
              <option value="shimmer">Shimmer (soft female)</option>
              <option value="alloy">Alloy (neutral)</option>
              <option value="echo">Echo (male)</option>
              <option value="fable">Fable (expressive)</option>
              <option value="onyx">Onyx (deep male)</option>
            </select>
            <span style={{ fontSize: 11, color: useOpenAI ? '#3a3' : '#888' }}>
              {useOpenAI ? '● AI voice' : '● Browser voice'}
            </span>
          </div>

          {/* Playback controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
            <button onClick={prevChapter} style={btnStyle}>⏮</button>
            <button onClick={prevPage}    style={btnStyle}>◀</button>
            <button onClick={togglePlay}
              style={{ ...btnStyle, width: 48, height: 48, background: '#BA7517', color: '#fff', border: 'none', fontSize: 18 }}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={nextPage}    style={btnStyle}>▶</button>
            <button onClick={nextChapter} style={btnStyle}>⏭</button>
            <button onClick={cycleSpeed}
              style={{ ...btnStyle, fontFamily: 'monospace', fontSize: 12, padding: '0 12px', width: 'auto' }}>
              {rate}×
            </button>
          </div>

          {/* Status */}
          <div style={{ textAlign: 'center', fontSize: 12, color: '#999' }}>
            {playing ? '▶ Reading...' : 'Ready'} — {chapters.length} chapters · {totalPages} pages
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
