// Records a demo video of the side panel: `npm run demo` → demo/out/demo.mp4 (and .webm).
//
// The real panel (extension/src/panel) runs in your installed Chrome with a fake chrome.* (demo/stub.js) and made-up
// data (demo/seed.js). Nothing talks to a real n8n instance, so the demo can click everything safely.
// A visible pointer and captions are drawn on top of the page. Frames come from Chrome's screencast (DevTools protocol)
// and are joined into an mp4 by ffmpeg. Needs Google Chrome and ffmpeg in PATH.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'extension');
const demoDir = path.join(root, 'demo');
const outDir = path.join(demoDir, 'out');
const W = 440;
const H = 860;

// ---- local server: the extension folder, the demo files, and the panel page with the stub and seed injected ----
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const INJECT = '<head><script src="/demo/stub.js"></script><script src="/demo/seed.js"></script>';
function panelHtml() {
  return fs.readFileSync(path.join(extDir, 'src/panel/panel.html'), 'utf8')
    .replace('<head>', INJECT)
    .replace('href="panel.css"', 'href="/src/panel/panel.css"')
    .replace('src="panel.js"', 'src="/src/panel/panel.js"')
    .replaceAll('"../../', '"/');
}
function optionsHtml() {
  return fs.readFileSync(path.join(extDir, 'src/options/options.html'), 'utf8')
    .replace('<head>', INJECT)
    .replace('"../panel/panel.css"', '"/src/panel/panel.css"')
    .replace('src="options.js"', 'src="/src/options/options.js"')
    .replaceAll('"../../', '"/');
}
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/demo/panel.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(panelHtml()); }
  if (p === '/demo/options.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(optionsHtml()); }
  const base = p.startsWith('/demo/') ? demoDir : extDir;
  const file = path.join(base, p.startsWith('/demo/') ? p.slice(6) : p);
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/demo/panel.html`;

// ---- overlay: pointer, click ripple and captions, drawn in the page ----
function installOverlay() {
  const css = document.createElement('style');
  css.textContent = `
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; pointer-events: none; width: 22px; height: 22px;
      transition: transform .7s cubic-bezier(.4,0,.2,1); filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    #demo-ripple { position: fixed; z-index: 99998; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; background: rgba(17,144,203,.35); transform: scale(0); opacity: 0; }
    #demo-ripple.go { animation: demo-ripple .5s ease-out; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    #demo-caption { position: fixed; left: 50%; bottom: 92px; z-index: 99997; pointer-events: none; transform: translate(-50%, 12px);
      max-width: 88%; width: max-content; padding: 10px 16px; border-radius: 12px; background: rgba(26,42,58,.94); color: #fff;
      font: 600 14px/1.4 Inter, 'Segoe UI', sans-serif; text-align: center; box-shadow: 0 6px 20px rgba(0,0,0,.25);
      opacity: 0; transition: opacity .35s, transform .35s; }
    #demo-caption.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-caption small { display: block; font-weight: 400; font-size: 12px; color: #b9d7e8; margin-top: 2px; }`;
  document.head.append(css);
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2l14 9-6.2 1.3L7.6 18z" fill="#fff" stroke="#1a2a3a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const ripple = document.createElement('div');
  ripple.id = 'demo-ripple';
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  document.body.append(cursor, ripple, caption);
  let pos = { x: innerWidth * 0.7, y: innerHeight * 0.4 };
  cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  window.__demo = {
    move(x, y) { pos = { x, y }; cursor.style.transform = `translate(${x - 3}px, ${y - 2}px)`; },
    ripple() {
      ripple.style.left = pos.x + 'px'; ripple.style.top = pos.y + 'px';
      ripple.classList.remove('go'); void ripple.offsetWidth; ripple.classList.add('go');
    },
    caption(text, sub) {
      caption.classList.remove('on');
      setTimeout(() => {
        caption.textContent = text;
        if (sub) { const s = document.createElement('small'); s.textContent = sub; caption.append(s); }
        caption.classList.toggle('on', Boolean(text));
      }, text ? 200 : 0);
    },
  };
}

// ---- record ----
fs.mkdirSync(outDir, { recursive: true });
const framesDir = path.join(outDir, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir);
// Sharp frames: render at twice the size (the screencast otherwise delivers frames at CSS-pixel size).
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=2'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'nl-NL' });
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

// Chrome sends a frame whenever the page changes; each frame is saved with its timestamp.
const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = path.join(framesDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

const pause = (ms) => page.waitForTimeout(ms);
// Show a caption for `ms`, then hide it, so it never hangs over the next step.
const caption = async (text, sub, ms = 2200) => {
  await page.evaluate(([t, s]) => window.__demo.caption(t, s), [text, sub]);
  await pause(ms);
  await page.evaluate(() => window.__demo.caption(''));
  await pause(250);
};
async function moveTo(locator) {
  await locator.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await pause(700);
  const b = await locator.boundingBox();
  await page.evaluate(([x, y]) => window.__demo.move(x, y), [b.x + b.width / 2, b.y + b.height / 2]);
  await pause(800);
}
async function click(locator, after = 1000) {
  await moveTo(locator);
  await page.evaluate(() => window.__demo.ripple());
  await locator.click();
  await pause(after);
}
async function typeIn(locator, text) {
  await click(locator, 300);
  await locator.pressSequentially(text, { delay: 110 });
  await pause(900);
}
const navigate = (p) => page.evaluate((p) => {
  window.__tabs[0].url = 'https://n8n.example.com' + p;
  return window.__fire('tabs.onUpdated', 1, { url: window.__tabs[0].url }, window.__tabs[0]);
}, p);

await page.goto(url);
await page.waitForSelector('#content .card');
await page.evaluate(installOverlay);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
await pause(600);

// 1. Overview
await caption('things.io Modules', 'n8n-workflows per module, in een zijpaneel naast n8n', 2600);
await moveTo(page.locator('#env'));
await caption('Productie valt meteen op', 'Volle badge en een dikke streep onder de kop');

// 2. Day agenda
await moveTo(page.locator('#agenda .ag-heat'));
await caption('Dagplanning', 'Alle schedules per uur; workflows op hetzelfde tijdstip vallen op');
const exact = page.locator('#agenda label.ag-only', { hasText: 'Alleen vaste tijden' });
await click(exact);
await caption('Alleen vaste tijden', 'Zonder elk-uur- en om-de-zoveel-minuten-schema\'s');
await click(page.locator('#agenda label.ag-only', { hasText: 'Alleen vaste tijden' }), 600);
await click(page.locator('#agenda .agenda-toggle'), 700);

// 3. Module cards
await moveTo(page.locator('.card[data-module="crm"] .modname'));
await caption('Elke module is een kaart', 'Tag mod:<naam> in n8n; met laatste run, triggers en afhankelijkheden');
await click(page.locator('.card[data-module="crm"] button.copy').first(), 600);
await caption('Webhook-URL kopiëren', 'Eén klik; Shift+klik geeft de test-URL', 1800);

// 3b. A workflow with only a manual trigger: no switch, it can't be published
await moveTo(page.locator('#content .chip.manual'));
await caption('Alleen een handmatige trigger', 'Geen schakelaar: zo’n workflow kan niet gepubliceerd worden', 2400);

// 4. Switch a module off: plan, snapshot and typed confirmation on Productie (cancelled at the end)
await click(page.locator('.card[data-module="crm"] .head button.switch'), 900);
await caption('Eerst een plan', 'In de juiste volgorde, met een snapshot om terug te zetten', 2400);
await typeIn(page.locator('#prodWord'), 'crm');
await caption('Op Productie typ je de modulenaam', 'Bevestigen werkt pas na snapshot en naam', 2200);
await click(page.locator('#dlg button', { hasText: 'Annuleren' }), 800);

// 5. Search
await typeIn(page.locator('#search'), 'enrich');
await caption('Zoeken tot in de nodes', 'Ook URL\'s en code in een workflow', 2200);
await page.locator('#search').fill('');
await page.locator('#search').dispatchEvent('input');
await pause(500);

// 6. Collapse and expand
await click(page.locator('#collapseAll'), 900);
await caption('Alles inklappen', 'De keuze wordt onthouden', 1500);
await click(page.locator('#collapseAll'), 800);

// 7. Tips footer
await click(page.locator('#tips .tip-next'), 700);
await caption('Tips van things.io', 'Wisselen vanzelf; te verbergen', 1800);

// 8. A workflow page: its executions
await caption('Open je een workflow in n8n…', 'Het paneel volgt de pagina: /workflow/<id>', 1800);
await navigate('/workflow/wfDag');
await page.waitForSelector('#wfview .ex');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await pause(800);
await caption('…dan zie je zijn uitvoeringen', 'Status, tijd, duur en hoe hij gestart is', 2400);
await click(page.locator('#wfview .ex-filters button', { hasText: 'Mislukt' }), 900);
await caption('Filter op mislukte runs', 'Klik op een nummer om de uitvoering in n8n te openen', 2200);
await click(page.locator('#wfview li.ex.fail details.ex-error > summary').nth(1), 1200);
await caption('De foutmelding, uitklapbaar', 'Melding, node, HTTP-status en het antwoord van de API', 2800);
await click(page.locator('#wfview li.ex.fail details.ex-error > summary').nth(1), 600);
await click(page.locator('#wfview .ex-filters button', { hasText: 'Alle' }), 600);
await click(page.locator('#wfview .ex-more'), 1000);
await caption('Steeds 20 tegelijk', 'Meer laden voor oudere uitvoeringen', 1800);
await click(page.locator('#tabOverview'), 900);
await caption('Wissel naar alle modules', 'Of terug naar deze workflow', 1600);
await click(page.locator('#tabWorkflow'), 900);

// 9. Settings page: preferences tab
await caption('Instellingen', 'Rechtsklik op het icoon → Opties, of ⚙ in het paneel', 1800);
await page.goto(url.replace('panel.html', 'options.html'));
await page.waitForSelector('#tab-prefs');
await page.evaluate(installOverlay);
await pause(500);
await click(page.locator('#tab-prefs'), 900);
await caption('Voorkeuren', 'Waar een workflow of uitvoering opent als je erop klikt', 2200);
await click(page.locator('label.choice', { hasText: 'Nieuw tabblad' }), 1000);
await caption('Direct opgeslagen', 'Het paneel volgt de keuze meteen', 1800);

// 10. Language: English (the real extension reloads its pages by itself; the demo reloads by hand)
await click(page.locator('label.choice', { hasText: 'English' }), 600);
await page.evaluate(() => localStorage.setItem('demoLanguage', 'en'));
await page.reload();
await page.waitForSelector('#tab-prefs');
await page.evaluate(installOverlay);
await pause(600);
await caption('Nederlands of English', 'Taal kiezen bij Voorkeuren, of automatisch de taal van Chrome', 2400);
await page.goto(url);
await page.waitForSelector('#content .card');
await page.evaluate(installOverlay);
await pause(500);
await caption('The panel in English', 'Every text, including schedules, runs and dialogs', 2600);
await moveTo(page.locator('.card[data-module="crm"] .modname'));
await pause(1200);

// End
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await caption('things.io Modules', 'github.com/hansblaauw64/n8n-module-manager', 3000);

await cdp.send('Page.stopScreencast');
await context.close();
await browser.close();
server.close();

// Join the frames: each one is shown until the next arrives (ffmpeg concat list with durations), at 30 fps.
const list = frames.map((f, i) => {
  const next = frames[i + 1]?.t ?? f.t + 0.5;
  return `file '${path.basename(f.file)}'\nduration ${Math.max(0.001, next - f.t).toFixed(3)}`;
});
list.push(`file '${path.basename(frames.at(-1).file)}'`); // concat needs the last file twice for its duration to count
fs.writeFileSync(path.join(framesDir, 'list.txt'), list.join('\n') + '\n');
const mp4 = path.join(outDir, 'demo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(framesDir, 'list.txt'),
  '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4]);
fs.rmSync(framesDir, { recursive: true, force: true });
const secs = (frames.at(-1).t - frames[0].t).toFixed(0);
console.log(`video: ${mp4} (${frames.length} frames, about ${secs} s)`);
