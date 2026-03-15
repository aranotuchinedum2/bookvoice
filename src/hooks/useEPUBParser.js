import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export async function parsePDF(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allPages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.(`Reading page ${i} of ${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let lastY = null, text = '';
    for (const item of tc.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 8) text += '\n';
      text += item.str;
      lastY = item.transform[5];
    }
    allPages.push({ n: i, text: text.trim() });
  }

  onProgress?.('Detecting chapters...');
  let chapters = [];

  try {
    const outline = await pdf.getOutline();
    if (outline?.length) chapters = await chaptersFromOutline(pdf, outline, allPages);
  } catch (_) {}

  if (!chapters.length) chapters = autoDetectChapters(allPages);
  return { chapters: chapters.filter(c => c.pages.length > 0), totalPages: pdf.numPages };
}

async function chaptersFromOutline(pdf, outline, allPages) {
  const flat = [];
  const flatten = (items) => items.forEach(it => {
    flat.push(it);
    if (it.items?.length) flatten(it.items);
  });
  flatten(outline);

  const result = [];
  for (const it of flat) {
    try {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await pdf.getDestination(dest);
      if (!dest) continue;
      const idx = await pdf.getPageIndex(dest[0]);
      result.push({ title: it.title || `Section ${result.length + 1}`, startPage: idx + 1 });
    } catch (_) {}
  }

  result.sort((a, b) => a.startPage - b.startPage);
  return result.map((ch, i) => {
    const end = i < result.length - 1 ? result[i + 1].startPage - 1 : allPages.length;
    const pages = allPages
      .filter(p => p.n >= ch.startPage && p.n <= end)
      .map(p => p.text)
      .filter(t => t.length > 40);
    return { ...ch, endPage: end, pages };
  });
}

export function autoDetectChapters(allPages) {
  const RE = [
    /^chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
    /^part\s+(\d+|[ivxlcdm]+)/i,
    /^(prologue|epilogue|introduction|preface|foreword|appendix|afterword|conclusion)/i,
  ];
  const chapters = [];
  let cur = null;

  for (const pg of allPages) {
    const first = pg.text.split('\n')[0]?.trim() || '';
    const isStart = RE.some(r => r.test(first));
    if (isStart || !cur) {
      if (cur) chapters.push(cur);
      cur = { title: isStart ? first.slice(0, 70) : 'Beginning', startPage: pg.n, endPage: pg.n, pages: [] };
    }
    cur.endPage = pg.n;
    if (pg.text.length > 40) cur.pages.push(pg.text);
  }
  if (cur) chapters.push(cur);

  // Fallback: group every 10 pages
  if (chapters.length <= 1) {
    return Array.from({ length: Math.ceil(allPages.length / 10) }, (_, i) => {
      const g = allPages.slice(i * 10, i * 10 + 10);
      return {
        title: `Pages ${g[0].n}–${g[g.length - 1].n}`,
        startPage: g[0].n, endPage: g[g.length - 1].n,
        pages: g.map(p => p.text).filter(t => t.length > 20)
      };
    });
  }
  return chapters;
}