/* Cozy Novel — js/ui/sent.js — WHAT WAS SENT, word for word: where it went,
 * the model, every message as it went (his instructions, the book, his
 * request), what came back counted, and the whole request to copy. For the
 * writer, the partner and the narrator alike, each named as itself. Never the
 * key: the headers are not kept. */

import * as store from '../store.js';
import { h, openSheet, toast, copyText } from './dom.js';
import { estimateTokens, plural } from '../util.js';

const WHO = { partner: 'your partner', play: 'the narrator' };

export async function showSent(novelId, key, purpose = '') {
  const s = openSheet(`What ${WHO[purpose] || 'the writer'} was sent`);
  s.body.append(h('p.say', 'Looking it up…'));
  /* the words on their way to the phone are waited for, never called missing (Cozy Tavern M347) */
  const kept = await store.sentKept(novelId, key);
  const { status, data } = await store.api('GET', `/api/sent/${novelId}/${key}`).catch(() => ({ status: 0 }));
  s.body.textContent = '';
  if (status !== 200 || !data) {
    s.body.append(h('p.say', status === 404 ? (kept.failed ? `This one was not kept: ${kept.failed} when it was sent.` : 'This one is not kept any more — the phone keeps what was sent for the newest sixty requests of each book.') : 'It could not be read just now.'));
    return;
  }
  const body = data.body || {};
  if (data.purpose && WHO[data.purpose]) s.setTitle(`What ${WHO[data.purpose]} was sent`);
  const msgs = [];
  if (typeof body.system === 'string' && body.system) msgs.push({ role: 'system', content: body.system });
  /* Claude's system in parts (the first kept ready by its cache) reads as one */
  if (Array.isArray(body.system)) msgs.push({ role: 'system', content: body.system.map((b) => (b && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n\n\n') });
  for (const m of body.messages || []) msgs.push(m);
  /* a message in parts (Claude keeping the start of the book ready) reads as one */
  const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) && c.every((x) => x && typeof x.text === 'string') ? c.map((x) => x.text).join('') : JSON.stringify(c, null, 2));
  const total = msgs.reduce((a, m) => a + estimateTokens(textOf(m.content)), 0);
  const u = data.usage || {};
  const facts = [
    ['Model', data.model || body.model || ''],
    ['Address', data.url || ''],
    ['When', data.at ? new Date(data.at).toLocaleString() : ''],
    ['How long', data.ms ? `${(data.ms / 1000).toFixed(1)} seconds` : ''],
    ['Sent', `about ${total.toLocaleString()} tokens${u.in ? ` (the provider counted ${u.in.toLocaleString()}${u.cached ? `, ${u.cached.toLocaleString()} from its cache` : ''})` : ''}`],
    ['Came back', u.out ? `${u.out.toLocaleString()} tokens` : ''],
    /* thinking asked for and not shown: said here, never over the page */
    ['Thinking', data.thought || ''],
  ].filter(([, v]) => v);
  s.body.append(h('ul.list', facts.map(([k, v]) => h('li', h('div.grow', h('small', k), v)))));
  const dials = Object.entries(body).filter(([k]) => !['messages', 'system', 'model', 'stream'].includes(k));
  if (dials.length) s.body.append(h('p.say', 'With: ' + dials.map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')));
  s.body.append(h('h3', { style: { font: '600 18px/1.2 var(--display)', margin: '18px 0 10px' } }, 'The messages, in order'));
  msgs.forEach((m, i) => {
    const text = textOf(m.content);
    const extra = Object.keys(m).filter((k) => k !== 'role' && k !== 'content');
    const box = h('div.sentmsg' + (i === msgs.length - 1 ? '.open' : ''),
      h('button', { onclick: () => box.classList.toggle('open') }, h('b', m.role === 'system' && i > 0 ? 'system (after the request)' : m.role), extra.length ? h('span', { style: { color: 'var(--chrome-soft)' } }, extra.map((k) => `${k}: ${JSON.stringify(m[k]).slice(0, 60)}`).join(' · ')) : null, h('small', `${plural(estimateTokens(text), 'token')}`)),
      h('pre', text));
    s.body.append(box);
  });
  s.body.append(h('div.btnrow', h('button.btn', { onclick: async () => toast((await copyText(JSON.stringify(body, null, 2))) ? 'The whole request is copied.' : 'It could not be copied.') }, 'Copy the whole request')));
}
