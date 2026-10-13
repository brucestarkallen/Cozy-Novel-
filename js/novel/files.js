/* Cozy Novel — js/novel/files.js — books in and out.
 *
 * Out: Markdown, plain text, a printable book (one HTML file that prints to a
 * PDF), and an e-book (EPUB) any reader app opens.
 * In: a text or Markdown file (split into chapters at its chapter headings),
 * a copy of the whole library, and the first Cozy Novel's books.
 */

import { newId, countWords, hashText, numberWords, slug } from '../util.js';
import { newNovel, newChapter, newPassage, newTurn, chapterLabel, passageText, picked, coverFor } from './shape.js';

/* ------------------------------------------------------------- out */

function chapterParas(chapter) {
  const out = [];
  for (const p of chapter.passages || []) {
    if (p.by === 'break') { out.push({ brk: true }); continue; }
    for (const line of passageText(p).split(/\n+/)) {
      const t = line.trim();
      if (!t) continue;
      if (/^(?:\*\s*\*\s*\*|-{3,}|_{3,}|#|⁂|~{3,}|\*{3,})$/.test(t)) out.push({ brk: true });
      else out.push({ text: t });
    }
  }
  return out;
}

export function toMarkdown(novel, chapters) {
  const lines = [`# ${novel.meta.title}`];
  if (novel.meta.subtitle) lines.push(`*${novel.meta.subtitle}*`);
  for (const id of novel.order || []) {
    const c = chapters[id];
    if (!c) continue;
    lines.push('', `## ${chapterLabel(novel, c)}`, '');
    for (const p of chapterParas(c)) lines.push(p.brk ? '* * *' : p.text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* plain words: *italic* and **bold** marks taken off, nothing else touched */
function plainWords(t) {
  return String(t).replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1').replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1$2');
}
export function toText(novel, chapters) {
  const lines = [novel.meta.title];
  if (novel.meta.subtitle) lines.push(novel.meta.subtitle);
  for (const id of novel.order || []) {
    const c = chapters[id];
    if (!c) continue;
    lines.push('', '', chapterLabel(novel, c), '');
    for (const p of chapterParas(c)) lines.push(p.brk ? '* * *' : plainWords(p.text), '');
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

/* text made safe for HTML and XML — and without the few control characters
 * XML may not hold at all (a stray form feed would break an e-book chapter) */
function esc(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* *italic* and **bold**, nothing else, on escaped text */
export function inlineMarks(escaped) {
  return escaped
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>');
}

function bookHtmlBody(novel, chapters, { xhtml = false } = {}) {
  const br = xhtml ? '<br/>' : '<br>';
  void br;
  const parts = [];
  for (const id of novel.order || []) {
    const c = chapters[id];
    if (!c) continue;
    const n = (novel.order || []).indexOf(id) + 1;
    parts.push(`<section class="chapter"><h2><span class="num">Chapter ${esc(numberWords(n))}</span>${c.name ? `<span class="name">${esc(c.name)}</span>` : ''}</h2>`);
    for (const p of chapterParas(c)) parts.push(p.brk ? '<p class="brk">❦</p>' : `<p>${inlineMarks(esc(p.text))}</p>`);
    parts.push('</section>');
  }
  return parts.join('\n');
}

const BOOK_CSS = `
body{margin:0;background:#fbf7ef;color:#2a2119;font-family:Literata,Georgia,'Noto Serif',serif;line-height:1.65;font-size:12pt}
main{max-width:34em;margin:0 auto;padding:3em 1.5em}
.title{text-align:center;margin:6em 0 8em}
.title h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:3em;margin:0 0 .2em;line-height:1.1}
.title p{font-style:italic;color:#6b5a48;margin:0}
.chapter{page-break-before:always;break-before:page}
h2{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;text-align:center;margin:3em 0 2em;line-height:1.2}
h2 .num{display:block;font-size:.8em;letter-spacing:.18em;text-transform:uppercase;color:#8a6d4c}
h2 .name{display:block;font-size:1.5em;font-style:italic}
p{margin:0;text-indent:1.4em;text-align:justify;hyphens:auto}
h2+p,.brk+p{text-indent:0}
.brk{text-align:center;text-indent:0;margin:1em 0;color:#8a6d4c}
@media print{body{background:#fff}main{padding:0}}
`;

async function fontFaces() {
  const files = [
    ['Literata', 'literata-latin-400-normal.woff2', 400, 'normal'],
    ['Literata', 'literata-latin-400-italic.woff2', 400, 'italic'],
    ['Literata', 'literata-latin-600-normal.woff2', 600, 'normal'],
    ['Cormorant Garamond', 'cormorant-latin-500-normal.woff2', 500, 'normal'],
    ['Cormorant Garamond', 'cormorant-latin-500-italic.woff2', 500, 'italic'],
    ['Cormorant Garamond', 'cormorant-latin-600-normal.woff2', 600, 'normal'],
  ];
  const out = [];
  for (const [family, file, weight, style] of files) {
    try {
      const res = await fetch(`/assets/fonts/${file}`);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      out.push(`@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');font-weight:${weight};font-style:${style}}`);
    } catch (_) { /* the book still prints in Georgia */ }
  }
  return out.join('\n');
}

export async function toPrintable(novel, chapters) {
  const faces = await fontFaces();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(novel.meta.title)}</title><style>${faces}\n${BOOK_CSS}</style></head><body><main><div class="title"><h1>${esc(novel.meta.title)}</h1>${novel.meta.subtitle ? `<p>${esc(novel.meta.subtitle)}</p>` : ''}</div>${bookHtmlBody(novel, chapters)}</main></body></html>`;
}

/* ----------------------------------------------- a small zip (store only) */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export async function toEpub(novel, chapters) {
  const id = 'urn:cozynovel:' + novel.id;
  const title = novel.meta.title;
  const items = [];
  const spine = [];
  const nav = [];
  let n = 0;
  for (const cid of novel.order || []) {
    const c = chapters[cid];
    if (!c) continue;
    n++;
    const file = `ch${String(n).padStart(3, '0')}.xhtml`;
    const label = chapterLabel(novel, c);
    const body = chapterParas(c).map((p) => (p.brk ? '<p class="brk">❦</p>' : `<p>${inlineMarks(esc(p.text))}</p>`)).join('\n');
    items.push({ name: `OEBPS/${file}`, data: `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(label)}</title><link rel="stylesheet" href="book.css"/></head><body><section class="chapter" epub:type="chapter"><h2><span class="num">Chapter ${esc(numberWords(n))}</span>${c.name ? `<span class="name">${esc(c.name)}</span>` : ''}</h2>\n${body}\n</section></body></html>` });
    spine.push(`<itemref idref="c${n}"/>`);
    nav.push(`<li><a href="${file}">${esc(label)}</a></li>`);
  }
  const manifest = items.map((it, i) => `<item id="c${i + 1}" href="${it.name.slice(6)}" media-type="application/xhtml+xml"/>`).join('');
  const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="css" href="book.css" media-type="text/css"/>${manifest}</manifest><spine><itemref idref="title"/>${spine.join('')}</spine></package>`;
  const navDoc = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${esc(title)}</h1><ol>${nav.join('')}</ol></nav></body></html>`;
  const titleDoc = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="book.css"/></head><body><div class="title"><h1>${esc(title)}</h1>${novel.meta.subtitle ? `<p>${esc(novel.meta.subtitle)}</p>` : ''}</div></body></html>`;
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: navDoc },
    { name: 'OEBPS/title.xhtml', data: titleDoc },
    { name: 'OEBPS/book.css', data: BOOK_CSS.replace('body{margin:0;background:#fbf7ef;', 'body{margin:0;') },
    ...items,
  ];
  return zip(files);
}

export function fileName(novel, ext) { return `${slug(novel.meta.title)}.${ext}`; }

/* -------------------------------------------------------------- in */

/* "Chapter 3", "CHAPTER III.", "Chapter Three: The Letter", "Prologue" */
const NUMBERISH = '(?:\\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z]+teen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ][a-z]+)?)';
const CHAPTER_LINE = new RegExp(`^(?:chapter|chap\\.)\\s+(${NUMBERISH})\\.?(?:\\s*[:.—–-]\\s*(.+))?$`, 'i');
const SPECIAL_LINE = /^(prologue|epilogue|interlude|afterword|foreword)\.?(?:\s*[:.—–-]\s*(.+))?$/i;
const MD_HEADING = /^(#{1,3})\s+(.+?)\s*#*$/;

/* a heading's own words: what names the chapter ('' when it only numbers it) */
function headingName(words) {
  const t = String(words || '').trim();
  const c = CHAPTER_LINE.exec(t);
  if (c) return (c[2] || '').trim();
  const sp = SPECIAL_LINE.exec(t);
  if (sp) return (sp[2] || '').trim() || sp[1].replace(/^./, (x) => x.toUpperCase()).replace(/^(.)(.*)$/, (m, a, b) => a + b.toLowerCase());
  return t;
}

/* A text or Markdown book: chapters at its chapter headings (or Markdown
 * headings); with none, the whole of it is one chapter. Every word is kept: a
 * line is a heading only when it stands alone as one, and anything else stays
 * in the story. A Markdown copy made here comes back the way it went out. */
export function fromText(name, raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const lines = text.split('\n');
  let title = String(name || '').replace(/\.(md|markdown|txt|text)$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported book';
  let subtitle = '';
  const chunks = [];
  let cur = null;
  const preface = [];
  const blank = (i) => i < 0 || i >= lines.length || !lines[i].trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const md = t.length <= 160 ? MD_HEADING.exec(t) : null;
    const plain = !md && t.length <= 120 && blank(i - 1) && blank(i + 1) && (CHAPTER_LINE.test(t) || SPECIAL_LINE.test(t));
    if (md || plain) {
      const words = md ? md[2] : t;
      /* a single "# Title" at the very top is the book's title — unless it is itself a chapter heading */
      if (md && md[1] === '#' && !chunks.length && !preface.join('').trim() && !CHAPTER_LINE.test(words) && !SPECIAL_LINE.test(words)) {
        title = words.trim();
        /* and an italic line right under it, its subtitle (as a copy made here has it) */
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const sub = j < lines.length ? /^\*([^*].*?)\*$/.exec(lines[j].trim()) : null;
        if (sub) { subtitle = sub[1].trim(); i = j; }
        continue;
      }
      cur = { name: headingName(words), lines: [] };
      chunks.push(cur);
      continue;
    }
    (cur ? cur.lines : preface).push(line);
  }
  if (preface.join('').trim()) chunks.unshift({ name: '', lines: preface });
  if (!chunks.length) chunks.push({ name: '', lines });
  const { novel } = newNovel({ title });
  if (subtitle) novel.meta.subtitle = subtitle;
  novel.order = [];
  const chapters = {};
  for (const ch of chunks) {
    const body = ch.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body && !ch.name) continue;
    const c = newChapter(novel.id);
    /* "Chapter 3" names nothing; "Chapter 3: The Letter" names "The Letter" */
    c.name = ch.name;
    if (c.name) c.nameBy = 'you';
    const scenes = body.split(/\n\s*(?:\*\s*\*\s*\*|-{3,}|#|⁂|\*{3,})\s*\n/);
    scenes.forEach((s, i) => {
      if (i > 0) c.passages.push(newPassage('break'));
      const words = s.trim();
      if (words) c.passages.push(newPassage('you', words, { how: 'imported', words: countWords(words) }));
    });
    novel.order.push(c.id);
    chapters[c.id] = c;
  }
  if (!novel.order.length) { const c = newChapter(novel.id); novel.order.push(c.id); chapters[c.id] = c; }
  let words = 0;
  for (const id of novel.order) for (const p of chapters[id].passages) if (p.by !== 'break') words += countWords(passageText(p));
  novel.meta.words = words;
  novel.meta.chapters = novel.order.length;
  return { novel, chapters };
}

/* The books in a copy of the library, as new books beside the ones here. */
export function booksFromLibrary(snap) {
  const recs = Array.isArray(snap && snap.records) ? snap.records : [];
  const novels = recs.filter((r) => r.kind === 'novel');
  const out = [];
  for (const nr of novels) {
    const old = nr.data;
    const nid = newId('n');
    const map = new Map();
    const novel = JSON.parse(JSON.stringify(old));
    novel.id = nid;
    novel.meta = { ...(novel.meta || {}), title: `${(novel.meta && novel.meta.title) || 'Untitled'}`, opened: Date.now() };
    novel.memory = { ...(novel.memory || {}), seen: {} };
    const chapters = {};
    novel.order = (old.order || []).map((cid) => {
      const r = recs.find((x) => x.kind === 'chapter' && x.id === cid);
      if (!r) return null;
      const c = JSON.parse(JSON.stringify(r.data));
      const id = newId('ch');
      map.set(cid, id);
      c.id = id; c.novelId = nid;
      chapters[id] = c;
      return id;
    }).filter(Boolean);
    const talk = recs.find((x) => x.kind === 'talk' && x.id === old.id);
    const plays = [];
    novel.plays = (old.plays || []).map((pid) => {
      const r = recs.find((x) => x.kind === 'play' && x.id === pid);
      if (!r) return null;
      const p = JSON.parse(JSON.stringify(r.data));
      const id = newId('pl');
      p.id = id; p.novelId = nid; p.chapterId = map.get(p.chapterId) || novel.order[novel.order.length - 1] || '';
      plays.push(p);
      return id;
    }).filter(Boolean);
    if (!novel.order.length) { const c = newChapter(nid); chapters[c.id] = c; novel.order = [c.id]; }
    out.push({ novel, chapters, talk: talk ? { ...JSON.parse(JSON.stringify(talk.data)), id: nid, novelId: nid } : null, plays });
  }
  return out;
}

/* ---------------------------------------------- the first Cozy Novel's books */

/* Its library (from the phone's old SQLite file, or a browser's old store, or
 * one of its backup files) as books here. Every word of every chapter is kept;
 * its Story Bible becomes the notes; its partner talk and explored scenes come
 * too. Ids are made from the old ones, so the same book read twice is the same
 * book. */
export function fromLegacy({ records = [], blobs = [] } = {}) {
  const blobText = new Map(blobs.map((b) => [b.id, String(b.text || '')]));
  const byId = new Map(records.map((r) => [r.id, r]));
  const textOf = (r) => (r && r.textBlobId ? blobText.get(r.textBlobId) || '' : '');
  /* the first version kept its times as ISO text */
  const when = (v, fallback) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : fallback;
  };
  const vid = (x) => 'v1-' + String(x).replace(/[^A-Za-z0-9_-]/g, '').slice(-60);
  const out = [];
  for (const old of records.filter((r) => r.type === 'novel')) {
    const nid = vid(old.id);
    const { novel } = newNovel({ title: old.title || 'Untitled' });
    novel.id = nid;
    novel.meta.cover = coverFor(old.title || '');
    novel.meta.created = when(old.createdAt, Date.now());
    novel.meta.written = when(old.updatedAt, novel.meta.created);
    novel.meta.opened = novel.meta.written;
    novel.meta.archived = Boolean(old.archivedAt);
    novel.brief = String(old.premise || '');
    const sp = old.styleProfile || {};
    const styleLines = [
      ['Point of view', sp.person], ['Viewpoint', sp.viewpoint], ['Tense', sp.tense], ['Voice', sp.voice], ['Dialogue', sp.dialogue],
      ['Genre', sp.genre], ['Tone', sp.tone], ['Pacing', sp.pacing], ['Notes', sp.instructions], ['Voice samples', sp.voiceSamples],
    ].filter(([, v]) => String(v || '').trim()).map(([k, v]) => `${k}: ${String(v).trim()}`);
    novel.style = styleLines.join('\n');
    novel.order = [];
    const chapters = {};
    const signs = [];
    const chapterNotes = [];
    for (const cid of old.orderedChapterIds || []) {
      const oc = byId.get(cid);
      if (!oc || oc.type !== 'chapter') continue;
      const c = newChapter(nid);
      c.id = vid(cid);
      const t = String(oc.title || '').trim();
      c.name = /^chapter\s+\w+$/i.test(t) ? '' : t;
      if (c.name) c.nameBy = 'you';
      const label = `Chapter ${numberWords(novel.order.length + 1)}${c.name ? ` — ${c.name}` : ''}`;
      const noteLines = [];
      if (String(oc.notes || '').trim()) noteLines.push(String(oc.notes).trim());
      let first = true;
      for (const sid of oc.orderedSceneIds || []) {
        const sc = byId.get(sid);
        if (!sc || sc.type !== 'scene') continue;
        const rev = byId.get(sc.currentRevisionId);
        const words = textOf(rev).replace(/\s+$/, '');
        signs.push(`${sid}:${sc.currentRevisionId}`);
        const sceneName = String(sc.title || '').trim();
        if (String(sc.notes || '').trim()) noteLines.push(`${sceneName || 'A scene'} — your notes: ${String(sc.notes).trim()}`);
        if (String(sc.summary || '').trim()) noteLines.push(`${sceneName || 'A scene'} — in short: ${String(sc.summary).trim()}`);
        if (!words.trim()) continue;
        if (!first) c.passages.push({ ...newPassage('break'), id: 'v1b-' + String(sid).replace(/[^A-Za-z0-9_-]/g, '').slice(-50) });
        first = false;
        const p = newPassage('you', words, { how: 'imported', words: countWords(words), note: sceneName, at: when(rev && rev.createdAt, Date.now()) });
        p.id = vid(sid);
        c.passages.push(p);
      }
      if (noteLines.length) chapterNotes.push({ id: vid(cid) + '-notes', name: `Notes on ${label}`, about: noteLines.join('\n') });
      novel.order.push(c.id);
      chapters[c.id] = c;
    }
    if (!novel.order.length) { const c = newChapter(nid); novel.order.push(c.id); chapters[c.id] = c; }
    /* its Story Bible */
    const mine = records.filter((r) => r.novelId === old.id);
    for (const e of mine.filter((r) => r.type === 'entity' && r.scope !== 'exploration')) {
      const kind = e.kind === 'person' ? 'people' : e.kind === 'place' ? 'places' : 'lore';
      const card = { id: vid(e.id), name: String(e.displayName || '').trim() || 'Unnamed', about: String(e.profile || e.biography || '').trim() };
      if (kind === 'people') { card.aka = Array.isArray(e.aliases) ? e.aliases.filter(Boolean) : []; card.now = ''; }
      novel.notes[kind].push(card);
    }
    const nameOf = (id) => { const e = byId.get(id); return e && e.displayName ? e.displayName : ''; };
    const KIND = { authorFact: 'Facts', biography: 'Facts', location: 'Facts', acceptedEvent: 'What has happened', worldRule: 'How the world works', relationship: 'Between people', knowledge: 'Who knows what', belief: 'Who believes what', secret: 'Secrets', condition: 'How people are', memory: 'Memories', note: 'Notes' };
    const facts = {};
    const plans = [];
    for (const r of mine.filter((x) => x.type === 'canon' && (x.status === 'active' || x.status === 'proposed'))) {
      const who = [nameOf(r.holderId), nameOf(r.subjectId)].filter(Boolean);
      const line = `${String(r.proposition || '').trim()}${who.length ? ` (${[...new Set(who)].join(', ')})` : ''}`;
      if (!String(r.proposition || '').trim()) continue;
      if (r.recordKind === 'plan' || r.recordKind === 'futureIdea' || r.recordKind === 'intention') { plans.push(`- ${line}`); continue; }
      if (r.recordKind === 'thread') { novel.notes.threads.push({ id: vid(r.id), name: line.slice(0, 80), about: line, open: true }); continue; }
      const k = KIND[r.recordKind] || 'Facts';
      (facts[k] || (facts[k] = [])).push(`- ${line}`);
    }
    for (const [k, lines] of Object.entries(facts)) novel.notes.lore.push({ id: vid(old.id) + '-' + slug(k, 20), name: k, about: lines.join('\n') });
    /* his notes on chapters and scenes ride as notes of their own */
    for (const card of chapterNotes) novel.notes.lore.push(card);
    if (plans.length) novel.plans = plans.join('\n');
    /* its partner talk */
    const talkTurns = mine.filter((r) => r.type === 'discussion').sort((a, b) => when(a.createdAt, 0) - when(b.createdAt, 0))
      .map((r) => { const t = newTurn(r.role === 'author' ? 'you' : 'ai', textOf(r)); t.id = vid(r.id); return t; })
      .filter((t) => String(t.versions[0].text || '').trim());
    const talk = talkTurns.length ? { id: nid, novelId: nid, turns: talkTurns, updated: Date.now() } : null;
    /* its explored scenes */
    const plays = [];
    for (const ex of mine.filter((r) => r.type === 'exploration')) {
      const turns = mine.filter((r) => r.type === 'turn' && r.parentSessionId === ex.id && (!ex.activeBranchId || r.branchId === ex.activeBranchId))
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
        .map((r) => { const t = newTurn(r.role === 'player' ? 'you' : 'ai', textOf(r)); t.id = vid(r.id); return t; })
        .filter((t) => String(t.versions[0].text || '').trim());
      if (!turns.length) continue;
      const scene = byId.get(ex.baseSceneId);
      const chapterId = scene ? vid(scene.chapterId) : novel.order[novel.order.length - 1];
      plays.push({ id: vid(ex.id), novelId: nid, chapterId: chapters[chapterId] ? chapterId : novel.order[novel.order.length - 1], after: null,
        who: nameOf(ex.playerCharacterId) || 'my character', from: '', title: '', turns, turned: null, created: when(ex.createdAt, Date.now()), updated: Date.now() });
    }
    novel.plays = plays.map((p) => p.id);
    /* his unsent words: the direction box and the partner box get them back */
    const draft = { id: nid, novelId: nid, direction: '', partner: '', play: {} };
    const kept = [];
    for (const d of mine.filter((r) => r.type === 'artifact' && r.kind === 'creativeDraft')) {
      const words = textOf(d).trim();
      if (!words) continue;
      const k = String(d.draftKind || '');
      if (/direction/i.test(k) && !draft.direction) draft.direction = words;
      else if (/question|partner|discussion/i.test(k) && !draft.partner) draft.partner = words;
      else kept.push({ what: 'Words you had not sent yet', text: words });
    }
    /* what has no place of its own here is kept with the book, word for word */
    const newestPrompt = {};
    for (const r of mine.filter((x) => x.type === 'prompt' && String(x.body || '').trim())) {
      if (!newestPrompt[r.kind] || (r.version || 0) > (newestPrompt[r.kind].version || 0)) newestPrompt[r.kind] = r;
    }
    for (const r of Object.values(newestPrompt)) kept.push({ what: `Your “${r.kind}” instructions`, text: String(r.body).trim() });
    for (const b of mine.filter((x) => x.type === 'bookmark')) {
      const sc = byId.get(b.sceneId);
      kept.push({ what: 'A bookmark', text: [String(b.label || '').trim(), sc && sc.title ? `in “${String(sc.title).trim()}”` : ''].filter(Boolean).join(' ') || 'a place in the book' });
    }
    let words = 0;
    for (const id of novel.order) for (const p of chapters[id].passages) if (p.by !== 'break') words += countWords(passageText(p));
    novel.meta.words = words;
    novel.meta.chapters = novel.order.length;
    novel.migrated = { from: 'cozy-novel-1', print: hashText(signs.join('|') + '|' + novel.order.map((id) => chapters[id].passages.map((p) => passageText(p)).join('\n')).join('\n')), at: Date.now(), ...(kept.length ? { kept } : {}) };
    out.push({ novel, chapters, talk, plays, draft: draft.direction || draft.partner ? draft : null, oldId: old.id, revisions: Object.fromEntries(signs.map((x) => x.split(':'))), byId });
  }
  return out;
}

/* Is one old copy of a scene's words newer than the other? The old app kept
 * every revision with its parent, so the answer is in its own history. */
export function revisionAncestry(byId, revId) {
  const seen = [];
  let cur = byId.get(revId);
  for (let i = 0; cur && i < 100000; i++) {
    seen.push(cur.id);
    cur = cur.parentRevisionId ? byId.get(cur.parentRevisionId) : null;
  }
  return seen;
}

/* Old connection profiles (with any key the old app was told to remember),
 * carrying exactly what the old app sent: a dial it had switched off is not
 * switched on here. */
const OLD_DIALS = [['temperature', 'temperature'], ['top_p', 'topP'], ['top_k', 'topK'], ['min_p', 'minP'],
  ['presence_penalty', 'presencePenalty'], ['frequency_penalty', 'frequencyPenalty'], ['repetition_penalty', 'repetitionPenalty'], ['seed', 'seed']];
export function connectionsFromLegacy(profiles = {}, secrets = {}) {
  const out = [];
  for (const p of Object.values(profiles || {})) {
    if (!p || typeof p !== 'object') continue;
    let url = String(p.baseUrl || p.endpoint || '').trim();
    url = url.replace(/\/(chat\/completions|messages|responses)\/?$/, '');
    const secret = p.secretReference && secrets[p.secretReference] ? String(secrets[p.secretReference].value || '') : '';
    const params = p.parameters || {};
    const caps = p.capabilities || {};
    const c = {
      id: 'v1-' + String(p.id || newId('c')).replace(/[^A-Za-z0-9_-]/g, '').slice(-60),
      name: String(p.displayName || p.model || 'Connection').trim(),
      url,
      model: String(p.model || '').trim(),
      key: secret,
    };
    if (p.adapter === 'anthropic') c.shape = 'anthropic';
    for (const [field, key] of OLD_DIALS) if (caps[field] && Number.isFinite(params[field])) c[key] = params[field];
    if (caps.stop && Array.isArray(params.stop) && params.stop.length) c.stop = params.stop.filter((x) => typeof x === 'string' && x);
    /* the thinking he chose, at the level he chose (the old "minimal" is the lightest here) */
    if (caps.reasoning && typeof params.reasoning === 'string' && params.reasoning) {
      const level = params.reasoning === 'minimal' ? 'low' : params.reasoning;
      if (['off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level)) c.thinking = level;
      if (p.thinkingMode === 'budget' && Number.isFinite(p.thinkingBudget) && p.thinkingBudget > 0) c.thinkingBudget = p.thinkingBudget;
    }
    /* only what he set himself: the old app's own defaults (a 2,000-token reply) are not his */
    if (Number.isFinite(p.outputOverride) && p.outputOverride > 0) c.maxTokens = p.outputOverride;
    if (Number.isFinite(p.contextOverride)) c.context = p.contextOverride;
    /* a prefill rides as the old app sent it: a thinking seed stays a seed, and one switched off stays off */
    const pf = typeof p.prefill === 'string' ? p.prefill.trim() : '';
    if (pf && p.prefillMode !== 'off' && p.prefillMode !== 'structured') c.prefill = p.prefillMode === 'thinking' ? `<think>${p.prefill}` : p.prefill;
    if (c.url && c.model) out.push(c);
  }
  return out;
}

export { picked };
