"""What the browser walks share: the real server and the stand-in model, started
fresh in a temporary folder, and a page sized like a phone (or not)."""
import asyncio, subprocess, sys, time, tempfile, os, json, urllib.request, traceback
from playwright.async_api import async_playwright
import pathlib
APP=str(pathlib.Path(__file__).resolve().parents[2])
SHOTS=tempfile.mkdtemp(prefix='cozynovel-shots-')
PROV=18299; PORT=18181
def reqs():
    return json.load(urllib.request.urlopen(f'http://127.0.0.1:{PROV}/requests'))['requests']
def reset():
    urllib.request.urlopen(f'http://127.0.0.1:{PROV}/reset').read()
class Env:
    def __init__(self, home=None):
        self.home=home or tempfile.mkdtemp()
    def __enter__(self):
        env=dict(os.environ, COZYNOVEL_HOME=self.home, COZYNOVEL_PORT=str(PORT))
        self.prov=subprocess.Popen([sys.executable,APP+'/tests/fake_provider.py',str(PROV)],stdout=subprocess.DEVNULL,stderr=subprocess.STDOUT)
        self.srv=subprocess.Popen([sys.executable,APP+'/serve.py'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        for _ in range(50):
            try: urllib.request.urlopen(f'http://127.0.0.1:{PORT}/api/version',timeout=1); break
            except Exception: time.sleep(0.1)
        return self
    def __exit__(self,*a):
        self.srv.terminate(); self.prov.terminate()
        try: out=self.srv.stdout.read().decode()
        except Exception: out=''
        if 'Traceback' in out: print('SERVER:', out[-3000:])
        import shutil
        shutil.rmtree(self.home, ignore_errors=True)
async def page(b, logs, w=412, hgt=915, mobile=True):
    ctx=await b.new_context(viewport={'width':w,'height':hgt},is_mobile=mobile,has_touch=mobile,device_scale_factor=2 if mobile else 1)
    pg=await ctx.new_page()
    pg.on('console',lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') else None)
    pg.on('pageerror',lambda e: logs.append(f'PAGEERROR: {e}'))
    pg.on('response',lambda r: logs.append(f'HTTP {r.status} {r.url}') if r.status>=400 else None)
    return pg
async def new_book(pg, title='The Lantern Keeper', brief='A lighthouse keeper on a stormy coast finds a letter in a bottle.'):
    await pg.goto(f'http://127.0.0.1:{PORT}/')
    await pg.wait_for_selector('#shelf:not([hidden]) #books > *:not(.shelfwait)', timeout=8000)
    if await pg.locator('button:has-text("Begin a book")').count():
        await pg.click('button:has-text("Begin a book")')
    else:
        await pg.click('button[aria-label="Begin a new book"]')
    await pg.fill('.sheet input[placeholder="A working title"]',title)
    await pg.fill('.sheet textarea',brief)
    await pg.click('text=Open the book')
    await pg.wait_for_selector('#desk:not([hidden])', timeout=8000)
async def panes_call(pg, name, args=()):
    """A pane opened from a walk (js/ui/panes.js showTurn, showSide): started in
    the page and waited on through a flag, never by holding the page's own
    promise open across the redraw it starts. Chromium's inspector holds that
    promise weakly; on a big page a garbage collection during the redraw
    "collects" it, and Playwright reports "Execution context was destroyed"
    with no navigation at all (walk_performance_panes, 2.11.1)."""
    await pg.evaluate("""([name, args]) => {
      window.__paneCall = null;
      import('/js/ui/panes.js').then((p) => { p[name](...args); window.__paneCall = 'ok'; },
        (e) => { window.__paneCall = 'error: ' + ((e && e.message) || e); });
    }""", [name, list(args)])
    await pg.wait_for_function("window.__paneCall !== null")
    said = await pg.evaluate("window.__paneCall")
    if said != 'ok':
        raise RuntimeError(f'{name} failed in the page: {said}')
async def settled_reload(pg, **kw):
    """A reload once the page's own steps back have landed (js/ui/dom.js
    afterBacks). A sheet or menu closed a moment before gives its history step
    back on the next turn of the page (dom.js sync -> history.go), and a reload
    in that moment is aborted by the browser: net::ERR_ABORTED, "maybe frame
    was detached" (walk_settings, 2.11.4; 4 reloads in 12 straight after a
    sheet closed, 0 in 24 after its step landed). He never reloads within the
    same few milliseconds; the walks wait as the app itself does before going
    somewhere new."""
    await pg.evaluate("() => { window.__backsLanded = false; import('/js/ui/dom.js').then((d) => d.afterBacks()).then(() => { window.__backsLanded = true; }, () => { window.__backsLanded = true; }); }")
    await pg.wait_for_function("window.__backsLanded === true")
    return await pg.reload(**kw)
async def add_conn(pg, model='fake-writer'):
    if 'Choose a writer' not in await pg.inner_text('#writerBtn'):
        await pg.click('#writerBtn'); await pg.click('.menu-pop button:has-text("Connections…")')
        await pg.fill('.sheet label.field:has(> span:text-is("Model")) input', model)
        await pg.wait_for_timeout(700)
        await pg.click('.sheet .head button[aria-label=Close]')
        await pg.wait_for_timeout(300)
        return
    await pg.click('#writerBtn')
    await pg.click('.menu-pop button:has-text("Add a connection")')
    await pg.click('.sheet button:has-text("Add a connection")')
    await pg.click('.menu-pop button:has-text("Anything else")')
    await pg.fill('.sheet input[placeholder="https://api.deepseek.com/v1"]',f'http://127.0.0.1:{PROV}/v1')
    await pg.fill('.sheet input[type=password]','test-key')
    await pg.fill('.sheet label.field:has(> span:text-is("Model")) input',model)
    await pg.wait_for_timeout(700)
    await pg.click('.sheet .head button[aria-label=Close]')
    await pg.wait_for_timeout(300)
