/* Cozy Novel — js/ui/sent.js — WHAT WAS SENT, word for word: where it went,
 * the model, every message as it went (his instructions, the book, his
 * request), what came back counted, and the whole request to copy. For the
 * writer, the partner and the narrator alike, each named as itself. Never the
 * key: the headers are not kept. */

import * as store from '../store.js';
import { h, openSheet, toast, copyText } from './dom.js';
import { estimateTokens, plural } from '../util.js';

const WHO = { partner: 'your partner', play: 'the narrator' };
let sentView = 0;

export async function showSent(novelId, key, purpose = '') {
  let closed = false;
  const view = ++sentView;
  const s = openSheet(`What ${WHO[purpose] || 'the writer'} was sent`, { onClose: () => { closed = true; } });
  s.wrap.classList.add('sentsheet');
  s.body.append(h('p.say.sent-empty', { role: 'status' }, 'Looking it up…'));
  /* the words on their way to the phone are waited for, never called missing (Cozy Tavern M347) */
  const kept = await store.sentKept(novelId, key);
  if (closed) return;
  const { status, data } = await store.api('GET', `/api/sent/${novelId}/${key}`).catch(() => ({ status: 0 }));
  if (closed) return;
  s.body.textContent = '';
  if (status !== 200 || !data) {
    s.body.append(h('p.say.sent-empty', { role: 'status' }, status === 404 ? (kept.failed ? `This one was not kept: ${kept.failed} when it was sent.` : 'This one is not kept any more — the phone keeps what was sent for the newest sixty requests of each book.') : 'It could not be read just now.'));
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
    ['When', data.at ? new Date(data.at).toLocaleString() : ''],
    ['How long', data.ms ? `${(data.ms / 1000).toFixed(1)} seconds` : ''],
    ['Sent', u.in ? `${u.in.toLocaleString()} tokens` : `about ${total.toLocaleString()} tokens`],
    ['Came back', u.out ? `${u.out.toLocaleString()} tokens` : ''],
  ].filter(([, v]) => v);
  s.body.append(h('p.sent-intro', 'The exact words behind this response, kept in the order they were sent.'),
    h('ul.list.sent-facts', facts.map(([k, v]) => h('li', { 'data-fact': k }, h('div.grow', h('small', k), h('span', v),
      k === 'Sent' && u.in ? h('span.sent-fact-note', `About ${total.toLocaleString()} estimated${u.cached ? ` · ${u.cached.toLocaleString()} from cache` : ''}`) : null)))));
  const dials = [
    ['Address', data.url || ''],
    /* thinking asked for and not shown: said here, never over the page */
    ['Thinking', data.thought || ''],
    ...Object.entries(body).filter(([k]) => !['messages', 'system', 'model', 'stream'].includes(k)),
  ].filter(([, v]) => v !== '' && v !== undefined && v !== null);
  if (dials.length) s.body.append(h('details.sent-details', h('summary', 'Request settings'),
    h('dl', dials.map(([k, v]) => h('div', h('dt', k), h('dd', typeof v === 'object' ? JSON.stringify(v) : String(v)))))));
  s.body.append(h('div.sent-section-title', h('h3', 'The messages, in order'), h('small', plural(msgs.length, 'message'))));
  msgs.forEach((m, i) => {
    const text = textOf(m.content);
    const extra = Object.keys(m).filter((k) => k !== 'role' && k !== 'content');
    const isOpen = i === msgs.length - 1;
    const role = m.role === 'system' && i > 0 ? 'system (after the request)' : m.role;
    const id = `sent-${view}-${i}`;
    const button = h('button', { 'aria-expanded': String(isOpen), 'aria-controls': id, title: `Show or fold the ${role} message.`, onclick: () => {
      button.setAttribute('aria-expanded', String(box.classList.toggle('open')));
    } }, h('span.sent-number', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
    h('span.sent-role', h('b', role), extra.length ? h('span.sent-extra', extra.map((k) => `${k}: ${JSON.stringify(m[k]).slice(0, 60)}`).join(' · ')) : null),
    h('small', `${plural(estimateTokens(text), 'token')}`), h('span.sent-chevron', { 'aria-hidden': 'true' }, '›'));
    const box = h('div.sentmsg' + (isOpen ? '.open' : ''), button,
      h('pre', { id, tabindex: '0', 'aria-label': `${role} message` }, text));
    s.body.append(box);
  });
  s.body.append(h('div.btnrow.sent-copy', h('button.btn', { title: 'Copy every message and request setting exactly as sent.', onclick: async () => toast((await copyText(JSON.stringify(body, null, 2))) ? 'The whole request is copied.' : 'It could not be copied.') }, 'Copy the whole request')));
}
