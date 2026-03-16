// This app was built by CeeJay for Chinedum Aranotu – 2026
import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

// ── Feature 6: Front matter patterns to auto-skip ─────────────────────────
const FRONT_RE = /^(copyright|title page|dedication|epigraph|table of contents|contents|acknowledgements?|preface|foreword|about the author|also by|half title|legal notice|isbn|publisher|imprint|praise for|advance praise)/i

// ── Feature 5: Text complexity → speed recommendation ─────────────────────
const analyzeText = (text) => {
  const words = text.trim().split(/\s+/)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text]
  const avgSentLen = words.length / Math.max(sentences.length, 1)
  const avgWordLen = words.reduce((a, w) => a + w.replace(/[^a-z]/gi, '').length, 0) / Math.max(words.length, 1)
  if (avgSentLen > 25 || avgWordLen > 6.5) return { rec: 0.9,  label: 'Dense text — try 0.9×' }
  if (avgSentLen > 18 || avgWordLen > 5.5) return { rec: 1.0,  label: 'Moderate — 1× works well' }
  if (avgSentLen < 12 && avgWordLen < 4.5) return { rec: 1.5,  label: 'Easy read — try 1.5×' }
  return { rec: 1.25, label: 'Good pace — try 1.25×' }
}

const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function App() {
  // ── Core ─────────────────────────────────────────────────────────────────
  const [screen, setScreen]              = useState('upload')
  const [loadMsg, setLoadMsg]            = useState('Processing book...')
  const [errMsg, setErrMsg]             = useState('')
  const [bookTitle, setBookTitle]        = useState('')
  const [chapters, setChapters]          = useState([])
  const [totalPages, setTotalPages]      = useState(0)
  const [chIdx, setChIdx]               = useState(0)
  const [pgIdx, setPgIdx]               = useState(0)
  const [playing, setPlaying]            = useState(false)
  const [paused, setPaused]             = useState(false)
  const [rate, setRate]                  = useState(1)
  const [spdIdx, setSpdIdx]             = useState(1)
  const [voice, setVoice]               = useState('nova')
  const [activeWordIdx, setActiveWordIdx] = useState(-1)
  const speeds = [0.75, 1, 1.25, 1.5, 2]
  const synth  = window.speechSynthesis

  // ── Feature 1: Sleep Timer ───────────────────────────────────────────────
  const [sleepMin, setSleepMin]           = useState(0)
  const [sleepLeft, setSleepLeft]         = useState(0)
  const sleepTimerRef  = useRef(null)
  const sleepTickRef   = useRef(null)

  // ── Feature 2: Bookmarks ─────────────────────────────────────────────────
  const [bookmarks, setBookmarks]         = useState([])
  const [showPanel, setShowPanel]         = useState(null) // 'bookmarks'|'library'|'highlights'|null

  // ── Feature 4: AI Chapter Summary ───────────────────────────────────────
  const [summary, setSummary]             = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [showSummary, setShowSummary]     = useState(false)
  const summaryCache = useRef({})

  // ── Feature 5: Speed Recommendation ─────────────────────────────────────
  const [speedRec, setSpeedRec]           = useState(null)

  // ── Feature 7: Recent Books ──────────────────────────────────────────────
  const [recentBooks, setRecentBooks]     = useState([])

  // ── Feature 9: Highlights ───────────────────────────────────────────────
  const [highlights, setHighlights]       = useState({}) // key=`ci-pi-wi`
  const [hlMode, setHlMode]               = useState(false)

  // ── Audio refs ───────────────────────────────────────────────────────────
  const audioRef     = useRef(null)
  const nextAudioRef = useRef(null)
  const chunksRef    = useRef([])
  const chunkIdxRef  = useRef(0)
  const seekingRef   = useRef(false)

  // ── Stable refs ──────────────────────────────────────────────────────────
  const chIdxRef    = useRef(chIdx)
  const pgIdxRef    = useRef(pgIdx)
  const chaptersRef = useRef(chapters)
  const rateRef     = useRef(rate)
  const voiceRef    = useRef(voice)
  const playingRef  = useRef(false)
  const pausedRef   = useRef(false)
  const bookTitleRef = useRef(bookTitle)

  useEffect(() => { chIdxRef.current    = chIdx },    [chIdx])
  useEffect(() => { pgIdxRef.current    = pgIdx },    [pgIdx])
  useEffect(() => { chaptersRef.current = chapters }, [chapters])
  useEffect(() => { rateRef.current     = rate },     [rate])
  useEffect(() => { voiceRef.current    = voice },    [voice])
  useEffect(() => { bookTitleRef.current = bookTitle }, [bookTitle])

  // Save progress + update recent books
  useEffect(() => {
    if (!bookTitle || !chapters.length) return
    const key = `bv_${bookTitle.replace(/\s+/g,'_')}`
    localStorage.setItem(key, JSON.stringify({ chIdx, pgIdx, ts: Date.now() }))
    updateRecent(bookTitle, chapters, totalPages, chIdx, pgIdx)
  }, [chIdx, pgIdx, bookTitle])

  // Load recent books on mount
  useEffect(() => {
    try { setRecentBooks(JSON.parse(localStorage.getItem('bv_recent') || '[]')) } catch (_) {}
  }, [])

  // Load bookmarks + highlights when book changes
  useEffect(() => {
    if (!bookTitle) return
    const k = bookTitle.replace(/\s+/g,'_')
    try { setBookmarks(JSON.parse(localStorage.getItem(`bv_bm_${k}`) || '[]')) } catch (_) {}
    try { setHighlights(JSON.parse(localStorage.getItem(`bv_hl_${k}`) || '{}')) } catch (_) {}
    summaryCache.current = {}
  }, [bookTitle])

  // Speed rec when page changes
  useEffect(() => {
    if (!chapters[chIdx]?.pages[pgIdx]) return
    setSpeedRec(analyzeText(chapters[chIdx].pages[pgIdx]))
  }, [chIdx, pgIdx, chapters])

  // AI summary when chapter changes
  useEffect(() => {
    if (screen !== 'player' || !chapters[chIdx]) return
    fetchSummary(chIdx)
  }, [chIdx, chapters, screen])

  // Feature 3: PWA - register service worker + MediaSession
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // ─── Feature 7: Recent Books ──────────────────────────────────────────────
  const updateRecent = (title, chs, total, ci, pi) => {
    try {
      const prev = JSON.parse(localStorage.getItem('bv_recent') || '[]')
      const updated = [
        { title, totalPages: total, chCount: chs.length, chTitle: chs[ci]?.title || '', ci, pi, ts: Date.now() },
        ...prev.filter(b => b.title !== title)
      ].slice(0, 5)
      localStorage.setItem('bv_recent', JSON.stringify(updated))
      setRecentBooks(updated)
    } catch (_) {}
  }

  // ─── Feature 1: Sleep Timer ───────────────────────────────────────────────
  const setSleepTimer = (min) => {
    clearTimeout(sleepTimerRef.current)
    clearInterval(sleepTickRef.current)
    setSleepMin(min); setSleepLeft(min * 60)
    if (!min) return
    let left = min * 60
    sleepTickRef.current = setInterval(() => {
      left -= 1; setSleepLeft(left)
      if (left <= 0) {
        clearInterval(sleepTickRef.current)
        if (audioRef.current) audioRef.current.pause()
        synth.pause()
        setPlaying(false); setPaused(true)
        playingRef.current = false; pausedRef.current = true
        setSleepMin(0); setSleepLeft(0)
      }
    }, 1000)
  }

  // ─── Feature 2: Bookmarks ─────────────────────────────────────────────────
  const addBookmark = () => {
    const ch = chaptersRef.current[chIdxRef.current]; if (!ch) return
    const bm = {
      id: Date.now(), chIdx: chIdxRef.current, pgIdx: pgIdxRef.current,
      wordIdx: activeWordIdx, chTitle: ch.title,
      pageNum: ch.startPage + pgIdxRef.current,
      snippet: ch.pages[pgIdxRef.current]?.slice(0, 100) || '',
      ts: Date.now()
    }
    const updated = [bm, ...bookmarks].slice(0, 30)
    setBookmarks(updated)
    try { localStorage.setItem(`bv_bm_${bookTitleRef.current.replace(/\s+/g,'_')}`, JSON.stringify(updated)) } catch (_) {}
  }

  const removeBookmark = (id) => {
    const updated = bookmarks.filter(b => b.id !== id)
    setBookmarks(updated)
    try { localStorage.setItem(`bv_bm_${bookTitleRef.current.replace(/\s+/g,'_')}`, JSON.stringify(updated)) } catch (_) {}
  }

  const goToBookmark = (bm) => {
    stopAll(); setChIdx(bm.chIdx); setPgIdx(bm.pgIdx)
    chIdxRef.current = bm.chIdx; pgIdxRef.current = bm.pgIdx
    setShowPanel(null)
  }

  // ─── Feature 9: Highlights ────────────────────────────────────────────────
  const toggleHighlight = (ci, pi, wi) => {
    const key = `${ci}-${pi}-${wi}`
    const updated = { ...highlights }
    if (updated[key]) delete updated[key]; else updated[key] = true
    setHighlights(updated)
    try { localStorage.setItem(`bv_hl_${bookTitleRef.current.replace(/\s+/g,'_')}`, JSON.stringify(updated)) } catch (_) {}
  }

  const exportHighlights = () => {
    const chs = chaptersRef.current
    const lines = [`BookVoice Highlights`, `Book: ${bookTitleRef.current}`, `Exported: ${new Date().toLocaleDateString()}`, '─'.repeat(50)]
    const keys = Object.keys(highlights).sort((a, b) => {
      const [ac,ap,aw] = a.split('-').map(Number), [bc,bp,bw] = b.split('-').map(Number)
      return ac-bc || ap-bp || aw-bw
    })
    let lastCh = -1
    for (const key of keys) {
      const [ci, pi, wi] = key.split('-').map(Number)
      const ch = chs[ci]; if (!ch) continue
      if (ci !== lastCh) { lines.push(`\n## ${ch.title}`); lastCh = ci }
      const words = ch.pages[pi]?.trim().split(/\s+/) || []
      const ctx = words.slice(Math.max(0, wi-4), wi+5).join(' ')
      lines.push(`  p.${ch.startPage + pi}: ...${ctx}...`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url
    a.download = `${bookTitleRef.current}_highlights.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Feature 4: AI Chapter Summary ───────────────────────────────────────
  const fetchSummary = async (ci) => {
    const ch = chaptersRef.current[ci]; if (!ch || voiceRef.current === 'browser') return
    const cacheKey = `${bookTitleRef.current}-${ci}`
    if (summaryCache.current[cacheKey]) { setSummary(summaryCache.current[cacheKey]); return }
    setSummaryLoading(true); setSummary('')
    try {
      const sample = ch.pages.slice(0, 2).join(' ').slice(0, 1200)
      const res = await fetch('/api/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterTitle: ch.title, text: sample })
      })
      if (!res.ok) throw new Error()
      const { summary: s } = await res.json()
      summaryCache.current[cacheKey] = s; setSummary(s)
    } catch (_) { setSummary('') }
    finally { setSummaryLoading(false) }
  }

  // ─── Feature 3: MediaSession (lockscreen controls) ────────────────────────
  const updateMediaSession = (chTitle) => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chTitle || bookTitleRef.current,
      artist: 'BookVoice', album: bookTitleRef.current
    })
    navigator.mediaSession.setActionHandler('play',          () => { if (!playingRef.current) togglePlay() })
    navigator.mediaSession.setActionHandler('pause',         () => { if (playingRef.current)  togglePlay() })
    navigator.mediaSession.setActionHandler('seekbackward',  () => skipSeconds(-10))
    navigator.mediaSession.setActionHandler('seekforward',   () => skipSeconds(10))
    navigator.mediaSession.setActionHandler('previoustrack', () => prevChapter())
    navigator.mediaSession.setActionHandler('nexttrack',     () => nextChapter())
  }

  // ─── Progress ─────────────────────────────────────────────────────────────
  const loadProgress = (title, chs) => {
    try {
      const saved = localStorage.getItem(`bv_${title.replace(/\s+/g,'_')}`)
      if (!saved) return { chIdx: 0, pgIdx: 0 }
      const { chIdx: c, pgIdx: p } = JSON.parse(saved)
      if (c >= chs.length) return { chIdx: 0, pgIdx: 0 }
      if (p >= chs[c].pages.length) return { chIdx: c, pgIdx: 0 }
      return { chIdx: c, pgIdx: p }
    } catch { return { chIdx: 0, pgIdx: 0 } }
  }

  // ─── File handler ─────────────────────────────────────────────────────────
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
      // Feature 6: skip front matter on first open
      const firstRealCh = result.chapters.findIndex(ch => !ch.isFrontMatter)
      const startCh = c > 0 ? c : (firstRealCh >= 0 ? firstRealCh : 0)
      setChIdx(startCh); setPgIdx(p); chIdxRef.current = startCh; pgIdxRef.current = p
      setScreen('player')
    } catch (e) {
      setErrMsg(e.message); setScreen('error')
      setTimeout(() => setScreen('upload'), 3000)
    }
  }

  // ─── PDF parser ───────────────────────────────────────────────────────────
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
      return { ...ch, endPage: end, pages, isFrontMatter: FRONT_RE.test(ch.title) }
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
        cur = { title: isStart ? first.slice(0, 70) : 'Beginning', startPage: pg.n, endPage: pg.n, pages: [], isFrontMatter: FRONT_RE.test(first) }
      }
      cur.endPage = pg.n
      if (pg.text.length > 40) cur.pages.push(pg.text)
    }
    if (cur) chs.push(cur)
    if (chs.length <= 1) {
      return Array.from({ length: Math.ceil(allPages.length / 10) }, (_, i) => {
        const g = allPages.slice(i * 10, i * 10 + 10)
        return { title: `Pages ${g[0].n}–${g[g.length-1].n}`, startPage: g[0].n, endPage: g[g.length-1].n, pages: g.map(p => p.text).filter(t => t.length > 20), isFrontMatter: false }
      })
    }
    return chs
  }

  // ─── EPUB parser ──────────────────────────────────────────────────────────
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
      chs.push({ title: chTitle.slice(0, 80), startPage: pgCtr, endPage: pgCtr + pgTxts.length - 1, pages: pgTxts, isFrontMatter: FRONT_RE.test(chTitle) })
      pgCtr += pgTxts.length
    }
    return { chapters: chs, totalPages: pgCtr - 1 }
  }

  // ─── Audio engine ─────────────────────────────────────────────────────────
  const makeChunksFromWords = (words, fromIdx = 0) => {
    const chunks = []; let chunk = '', start = fromIdx
    for (let i = fromIdx; i < words.length; i++) {
      const w = words[i]
      if ((chunk + ' ' + w).length > 500 && chunk) {
        const wc = chunk.trim().split(/\s+/).length
        chunks.push({ text: chunk.trim(), startWordIdx: start, wordCount: wc })
        start = i; chunk = w
      } else chunk += (chunk ? ' ' : '') + w
    }
    if (chunk.trim()) {
      const wc = chunk.trim().split(/\s+/).length
      chunks.push({ text: chunk.trim(), startWordIdx: start, wordCount: wc })
    }
    return chunks
  }

  const prefetchChunk = async (text) => {
    if (!text) return null
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceRef.current, speed: rateRef.current }),
      })
      if (!res.ok) return null
      return URL.createObjectURL(await res.blob())
    } catch { return null }
  }

  const advancePage = () => {
    setActiveWordIdx(-1)
    const chs = chaptersRef.current, ci = chIdxRef.current, pi = pgIdxRef.current
    if (pi < chs[ci].pages.length - 1) {
      const nextPg = pi + 1; setPgIdx(nextPg); pgIdxRef.current = nextPg
      playFromWord(chs[ci].pages[nextPg], 0)
    } else {
      // Feature 6: skip front matter when auto-advancing
      let nextCh = ci + 1
      while (nextCh < chs.length && chs[nextCh].isFrontMatter) nextCh++
      if (nextCh < chs.length) {
        setChIdx(nextCh); setPgIdx(0); chIdxRef.current = nextCh; pgIdxRef.current = 0
        playFromWord(chs[nextCh].pages[0], 0)
      } else {
        setPlaying(false); setPaused(false); playingRef.current = false; pausedRef.current = false
      }
    }
  }

  const playChunks = async (chunks, startIdx) => {
    if (startIdx >= chunks.length) { advancePage(); return }
    chunkIdxRef.current = startIdx
    const chunk = chunks[startIdx]
    setActiveWordIdx(chunk.startWordIdx)

    let url = nextAudioRef.current; nextAudioRef.current = null
    if (!url) url = await prefetchChunk(chunk.text)
    seekingRef.current = false
    if (!url) { readPageBrowser(chIdxRef.current, pgIdxRef.current); return }

    if (startIdx + 1 < chunks.length) {
      prefetchChunk(chunks[startIdx + 1].text).then(u => { nextAudioRef.current = u })
    }

    if (audioRef.current) {
      audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current.ontimeupdate = null
      audioRef.current.pause(); audioRef.current = null
    }

    const audio = new Audio(url); audioRef.current = audio
    audio.playbackRate = rateRef.current

    audio.ontimeupdate = () => {
      if (!audio.duration || audio.duration === Infinity) return
      const wordOffset = Math.min(Math.floor((audio.currentTime / audio.duration) * chunk.wordCount), chunk.wordCount - 1)
      setActiveWordIdx(chunk.startWordIdx + wordOffset)
    }
    audio.onended = () => {
      URL.revokeObjectURL(url)
      setActiveWordIdx(chunk.startWordIdx + chunk.wordCount - 1)
      if (playingRef.current && !pausedRef.current) playChunks(chunks, startIdx + 1)
    }
    audio.onerror = () => { setPlaying(false); playingRef.current = false; readPageBrowser(chIdxRef.current, pgIdxRef.current) }

    audio.play()
    setPlaying(true); setPaused(false); playingRef.current = true; pausedRef.current = false

    // Feature 3: update lockscreen
    updateMediaSession(chaptersRef.current[chIdxRef.current]?.title)
  }

  const playFromWord = (fullText, fromWordIdx) => {
    const words  = fullText.trim().split(/\s+/)
    const chunks = makeChunksFromWords(words, fromWordIdx)
    chunksRef.current = chunks
    if (nextAudioRef.current) { URL.revokeObjectURL(nextAudioRef.current); nextAudioRef.current = null }
    seekingRef.current = true
    playChunks(chunks, 0)
  }

  const handleWordClick = (wordIdx) => {
    const fullText = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current]
    if (!fullText) return

    // Feature 9: highlight mode — double-click handled via dblClick, single = read
    if (hlMode) { toggleHighlight(chIdxRef.current, pgIdxRef.current, wordIdx); return }

    if (audioRef.current) {
      audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current.ontimeupdate = null
      audioRef.current.pause(); audioRef.current = null
    }
    if (nextAudioRef.current) { URL.revokeObjectURL(nextAudioRef.current); nextAudioRef.current = null }
    synth.cancel()

    setActiveWordIdx(wordIdx); setPlaying(true); setPaused(false)
    playingRef.current = true; pausedRef.current = false

    if (voiceRef.current === 'browser') {
      const words = fullText.trim().split(/\s+/)
      readTextBrowser(words.slice(wordIdx).join(' '), wordIdx)
    } else {
      playFromWord(fullText, wordIdx)
    }
  }

  const skipSeconds = (secs) => {
    if (audioRef.current && !isNaN(audioRef.current.duration)) {
      const t = audioRef.current.currentTime + secs
      if (t < 0) audioRef.current.currentTime = 0
      else if (t >= audioRef.current.duration) { const e = audioRef.current.onended; if (e) e() }
      else audioRef.current.currentTime = t
    } else if (synth.speaking || paused) {
      const wpm = 150 * rateRef.current
      const skip = Math.round((wpm / 60) * Math.abs(secs)) * (secs > 0 ? 1 : -1)
      const text = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current] || ''
      const words = text.trim().split(/\s+/)
      const newIdx = Math.max(0, Math.min(words.length - 1, activeWordIdx + skip))
      handleWordClick(newIdx)
    }
  }

  const readPageBrowser = (chI, pgI) => {
    const text = chaptersRef.current[chI]?.pages[pgI]; if (!text?.trim()) return
    readTextBrowser(text, 0)
  }

  const readTextBrowser = (text, startWordIdx = 0) => {
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text); u.rate = rateRef.current
    u.onstart = () => { setPlaying(true); setPaused(false); playingRef.current = true }
    u.onboundary = (e) => {
      if (e.name !== 'word') return
      const spokenWords = text.slice(0, e.charIndex + 1).trim().split(/\s+/)
      setActiveWordIdx(startWordIdx + spokenWords.length - 1)
    }
    u.onend = () => {
      setActiveWordIdx(-1)
      const chs = chaptersRef.current, ci = chIdxRef.current, pi = pgIdxRef.current
      if (pi < chs[ci].pages.length - 1) {
        const n = pi + 1; setPgIdx(n); pgIdxRef.current = n; readPageBrowser(ci, n)
      } else if (ci < chs.length - 1) {
        const nc = ci + 1; setChIdx(nc); setPgIdx(0); chIdxRef.current = nc; pgIdxRef.current = 0; readPageBrowser(nc, 0)
      } else { setPlaying(false); playingRef.current = false }
    }
    u.onerror = (e) => { if (e.error !== 'interrupted') { setPlaying(false); playingRef.current = false } }
    synth.speak(u)
    updateMediaSession(chaptersRef.current[chIdxRef.current]?.title)
  }

  const stopAll = () => {
    if (audioRef.current) {
      audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current.ontimeupdate = null
      audioRef.current.pause(); audioRef.current = null
    }
    if (nextAudioRef.current) { URL.revokeObjectURL(nextAudioRef.current); nextAudioRef.current = null }
    synth.cancel(); clearTimeout(sleepTimerRef.current); clearInterval(sleepTickRef.current)
    setPlaying(false); setPaused(false); playingRef.current = false; pausedRef.current = false; seekingRef.current = false
    chunksRef.current = []; chunkIdxRef.current = 0; setActiveWordIdx(-1)
  }

  const togglePlay = () => {
    if (seekingRef.current) return
    if (playing) {
      if (audioRef.current) audioRef.current.pause()
      synth.pause(); setPlaying(false); setPaused(true); playingRef.current = false; pausedRef.current = true
    } else if (paused) {
      pausedRef.current = false; setPaused(false)
      if (audioRef.current) { audioRef.current.play(); setPlaying(true); playingRef.current = true }
      else if (voiceRef.current === 'browser') { synth.resume(); setPlaying(true); playingRef.current = true }
      else {
        const chunks = chunksRef.current, idx = chunkIdxRef.current
        if (chunks.length && idx < chunks.length) playChunks(chunks, idx)
        else { const t = chaptersRef.current[chIdxRef.current]?.pages[pgIdxRef.current]; if (t) playFromWord(t, 0) }
      }
    } else {
      const text = chapters[chIdx]?.pages[pgIdx]; if (!text) return
      if (voiceRef.current === 'browser') readPageBrowser(chIdx, pgIdx)
      else playFromWord(text, 0)
    }
  }

  const prevPage = () => {
    stopAll()
    if (pgIdx > 0) { const p = pgIdx - 1; setPgIdx(p); pgIdxRef.current = p }
    else if (chIdx > 0) { const c = chIdx - 1; const p = chapters[c].pages.length - 1; setChIdx(c); setPgIdx(p); chIdxRef.current = c; pgIdxRef.current = p }
  }
  const nextPage = () => {
    stopAll()
    const c = chapters[chIdx]
    if (pgIdx < c.pages.length - 1) { const p = pgIdx + 1; setPgIdx(p); pgIdxRef.current = p }
    else if (chIdx < chapters.length - 1) { const nc = chIdx + 1; setChIdx(nc); setPgIdx(0); chIdxRef.current = nc; pgIdxRef.current = 0 }
  }
  const prevChapter = () => { stopAll(); if (chIdx > 0) { const c = chIdx - 1; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 } }
  const nextChapter = () => { stopAll(); if (chIdx < chapters.length - 1) { const c = chIdx + 1; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 } }
  const cycleSpeed = () => {
    const next = (spdIdx + 1) % speeds.length, newRate = speeds[next]
    setSpdIdx(next); setRate(newRate); rateRef.current = newRate
    if (audioRef.current) audioRef.current.playbackRate = newRate
  }

  // ─── Render clickable words ───────────────────────────────────────────────
  const renderPageText = (text) => {
    if (!text) return null
    const tokens = text.split(/(\s+)/); let wordIdx = 0
    return tokens.map((token, i) => {
      if (/^\s+$/.test(token)) return <span key={i}>{token}</span>
      const idx      = wordIdx++
      const isActive = idx === activeWordIdx
      const isHl     = !!highlights[`${chIdx}-${pgIdx}-${idx}`]
      return (
        <span key={i}
          onClick={() => handleWordClick(idx)}
          onDoubleClick={() => toggleHighlight(chIdx, pgIdx, idx)}
          title={hlMode ? 'Click to highlight' : 'Click to read from here · Double-click to highlight'}
          style={{
            cursor:       'pointer',
            background:   isActive ? '#BA7517' : isHl ? '#fbbf24' : 'transparent',
            color:        isActive ? '#fff' : 'inherit',
            borderRadius: (isActive || isHl) ? '3px' : '0',
            padding:      (isActive || isHl) ? '1px 3px' : '0',
            transition:   'background 0.1s',
          }}>
          {token}
        </span>
      )
    })
  }

  const ch = chapters[chIdx]

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem 6rem', fontFamily: 'system-ui, sans-serif' }}>

      {/* UPLOAD */}
      {screen === 'upload' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ margin: 0 }}>BookVoice</h2>
            {recentBooks.length > 0 && (
              <button onClick={() => setShowPanel(showPanel === 'library' ? null : 'library')}
                style={ghostBtn}>📚 Library ({recentBooks.length})</button>
            )}
          </div>

          {/* Feature 7: Recent Books panel */}
          {showPanel === 'library' && (
            <div style={panelStyle}>
              <div style={panelHeader}><span>Recent Books</span><button onClick={() => setShowPanel(null)} style={closeBtn}>✕</button></div>
              {recentBooks.map((b, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '0.5px solid #eee' }}>
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{b.title}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{b.chTitle} · p.{(chapters[b.ci]?.startPage || 0) + b.pi} · {b.chCount} chapters</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Last read: {new Date(b.ts).toLocaleDateString()}</div>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#bbb', marginTop: 8 }}>Re-upload any book to continue from your saved position.</div>
            </div>
          )}

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
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* ERROR */}
      {screen === 'error' && <div style={{ color: 'red', textAlign: 'center', padding: '2rem' }}>{errMsg}</div>}

      {/* PLAYER */}
      {screen === 'player' && ch && (
        <div>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, fontWeight: 500, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{bookTitle}</div>
            <button onClick={addBookmark} style={ghostBtn} title="Add bookmark">🔖</button>
            <button onClick={() => setShowPanel(showPanel === 'bookmarks' ? null : 'bookmarks')} style={ghostBtn}>
              Bookmarks {bookmarks.length > 0 && `(${bookmarks.length})`}
            </button>
            <button onClick={() => setShowPanel(showPanel === 'highlights' ? null : 'highlights')} style={ghostBtn}>
              Highlights {Object.keys(highlights).length > 0 && `(${Object.keys(highlights).length})`}
            </button>
            <button onClick={() => { stopAll(); setShowPanel(null); setScreen('upload') }} style={ghostBtn}>+ New</button>
          </div>

          {/* Feature 2: Bookmarks panel */}
          {showPanel === 'bookmarks' && (
            <div style={panelStyle}>
              <div style={panelHeader}><span>Bookmarks</span><button onClick={() => setShowPanel(null)} style={closeBtn}>✕</button></div>
              {bookmarks.length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No bookmarks yet. Hit 🔖 while reading.</div>}
              {bookmarks.map(bm => (
                <div key={bm.id} style={{ padding: '8px 0', borderBottom: '0.5px solid #eee', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => goToBookmark(bm)}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{bm.chTitle}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>p.{bm.pageNum} · {new Date(bm.ts).toLocaleDateString()}</div>
                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{bm.snippet}...</div>
                  </div>
                  <button onClick={() => removeBookmark(bm.id)} style={{ ...closeBtn, color: '#ccc' }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Feature 9: Highlights panel */}
          {showPanel === 'highlights' && (
            <div style={panelStyle}>
              <div style={panelHeader}>
                <span>Highlights ({Object.keys(highlights).length})</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {Object.keys(highlights).length > 0 && <button onClick={exportHighlights} style={ghostBtn}>Export .txt</button>}
                  <button onClick={() => setShowPanel(null)} style={closeBtn}>✕</button>
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Double-click any word to highlight it. Click to read from there.</div>
              {Object.keys(highlights).length === 0 && <div style={{ color: '#aaa', fontSize: 13 }}>No highlights yet. Double-click any word.</div>}
              {Object.keys(highlights).sort().map(key => {
                const [ci, pi, wi] = key.split('-').map(Number)
                const c = chapters[ci]; if (!c) return null
                const words = c.pages[pi]?.trim().split(/\s+/) || []
                const ctx = words.slice(Math.max(0,wi-3), wi+4).join(' ')
                return (
                  <div key={key} style={{ padding: '6px 0', borderBottom: '0.5px solid #eee', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
                    onClick={() => { goToBookmark({ chIdx: ci, pgIdx: pi, wordIdx: wi, chTitle: c.title, pageNum: c.startPage + pi, ts: Date.now() }) }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: '#888' }}>{c.title} · p.{c.startPage + pi}</div>
                      <div style={{ fontSize: 13, background: '#fef3c7', borderRadius: 3, padding: '1px 4px', display: 'inline' }}>...{ctx}...</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); toggleHighlight(ci, pi, wi) }} style={{ ...closeBtn, color: '#ccc' }}>✕</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Feature 4: AI Chapter Summary */}
          {(summary || summaryLoading) && (
            <div style={{ background: '#f0f7ff', border: '1px solid #bde', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#4a8', fontWeight: 500 }}>✦ AI Chapter Summary</span>
                <button onClick={() => setShowSummary(!showSummary)} style={{ ...ghostBtn, fontSize: 11 }}>{showSummary ? 'Hide' : 'Show'}</button>
              </div>
              {showSummary && (
                <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                  {summaryLoading ? 'Summarizing...' : summary}
                </div>
              )}
            </div>
          )}

          {/* Chapter selector */}
          <select value={chIdx}
            onChange={e => { stopAll(); const c = +e.target.value; setChIdx(c); setPgIdx(0); chIdxRef.current = c; pgIdxRef.current = 0 }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, marginBottom: 12, background: '#fff' }}>
            {chapters.map((c, i) => <option key={i} value={i}>{c.isFrontMatter ? '↷ ' : ''}{c.title}</option>)}
          </select>

          {/* Page text */}
          <div style={{ background: '#fdf8f0', border: '1px solid #f0e0c0', borderRadius: 10, padding: '1.25rem 1.5rem', marginBottom: 6, maxHeight: 260, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
              <span>Page {ch.startPage + pgIdx} of {ch.endPage}</span>
              {ch.isFrontMatter && <span style={{ color: '#f59e0b' }}>Front matter</span>}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.9, color: '#222', userSelect: 'none' }}>
              {renderPageText(ch.pages[pgIdx])}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#bbb', textAlign: 'center', marginBottom: 10 }}>
            {hlMode ? '🖊 Highlight mode — click to mark, click again to unmark' : 'Tap word to read from there · Double-click to highlight'}
          </div>

          {/* Voice + Sleep Timer row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
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
              <option value="browser">Browser (free)</option>
            </select>
            <span style={{ fontSize: 11, color: voice === 'browser' ? '#888' : '#3a3' }}>
              {voice === 'browser' ? '● Browser' : '● AI'}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#888' }}>😴</label>
              <select value={sleepMin} onChange={e => setSleepTimer(+e.target.value)}
                style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #ddd', background: '#fff' }}>
                <option value={0}>Sleep: Off</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
              {sleepLeft > 0 && <span style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'monospace' }}>{fmt(sleepLeft)}</span>}
            </div>
          </div>

          {/* Feature 5: Speed rec badge */}
          {speedRec && (
            <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginBottom: 8 }}>
              💡 {speedRec.label}
            </div>
          )}

          {/* Highlight mode toggle */}
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <button onClick={() => setHlMode(!hlMode)}
              style={{ ...ghostBtn, background: hlMode ? '#fef3c7' : 'transparent', borderColor: hlMode ? '#f59e0b' : '#ddd' }}>
              {hlMode ? '🖊 Exit highlight mode' : '🖊 Highlight mode'}
            </button>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <button onClick={prevChapter} style={btnStyle} title="Prev chapter">⏮</button>
            <button onClick={prevPage}    style={btnStyle} title="Prev page">◀</button>
            <button onClick={() => skipSeconds(-10)} style={btnStyle} title="Back 10s">
              <span style={{ fontSize: 10, fontWeight: 700 }}>-10s</span>
            </button>
            <button onClick={togglePlay}
              style={{ ...btnStyle, width: 52, height: 52, background: '#BA7517', color: '#fff', border: 'none', fontSize: 20 }}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => skipSeconds(10)} style={btnStyle} title="Forward 10s">
              <span style={{ fontSize: 10, fontWeight: 700 }}>+10s</span>
            </button>
            <button onClick={nextPage}    style={btnStyle} title="Next page">▶</button>
            <button onClick={nextChapter} style={btnStyle} title="Next chapter">⏭</button>
            <button onClick={cycleSpeed} style={{ ...btnStyle, fontFamily: 'monospace', fontSize: 12, padding: '0 12px', width: 'auto' }}>
              {rate}×
            </button>
          </div>

          {/* Status */}
          <div style={{ textAlign: 'center', fontSize: 12, color: '#999', marginBottom: 8 }}>
            {playing ? '▶ Reading...' : paused ? '⏸ Paused' : 'Ready'}
            {' '}— {chapters.length} ch · {totalPages} pages
          </div>

          {/* Signature */}
          <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #eee', textAlign: 'center', fontSize: 11, color: '#bbb' }}>
            This app was built by CeeJay for Chinedum Aranotu – 2026
          </div>

        </div>
      )}

      {/* Feature 8: Mini Player Bar — sticky bottom */}
      {screen === 'player' && ch && (playing || paused) && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderTop: '1px solid #eee',
          padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)', zIndex: 100
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</div>
            <div style={{ fontSize: 11, color: '#888' }}>p.{ch.startPage + pgIdx} · {playing ? '▶ Reading' : '⏸ Paused'}</div>
          </div>
          <button onClick={() => skipSeconds(-10)} style={{ ...btnStyle, width: 32, height: 32 }}>
            <span style={{ fontSize: 9, fontWeight: 700 }}>-10s</span>
          </button>
          <button onClick={togglePlay}
            style={{ ...btnStyle, width: 40, height: 40, background: '#BA7517', color: '#fff', border: 'none', fontSize: 16 }}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => skipSeconds(10)} style={{ ...btnStyle, width: 32, height: 32 }}>
            <span style={{ fontSize: 9, fontWeight: 700 }}>+10s</span>
          </button>
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
const ghostBtn = {
  fontSize: 12, padding: '4px 10px', borderRadius: 6,
  border: '1px solid #ddd', background: 'transparent', cursor: 'pointer',
}
const panelStyle = {
  background: '#fff', border: '1px solid #eee', borderRadius: 10,
  padding: '12px 16px', marginBottom: 16, maxHeight: 280, overflowY: 'auto',
}
const panelHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 10, fontWeight: 500, fontSize: 14,
}
const closeBtn = {
  background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', padding: '0 4px',
}
