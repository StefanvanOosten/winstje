// Doorloopt de app in Chrome op telefoonformaat: `npm run test:browser`.
// Start zelf een webserver en een lege Chrome, dus er gaat niets naar Supabase.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = fileURLToPath(new URL('..', import.meta.url));
const FOTO_MAP = join(tmpdir(), 'winstje-browsertest');
const WEB = 8125;
const CDP = 9362;
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = createServer((vraag, antwoord) => {
  const pad = decodeURIComponent(vraag.url.split('?')[0]);
  const bestand = join(MAP, pad === '/' ? 'index.html' : pad);
  if (!bestand.startsWith(MAP) || !existsSync(bestand)) {
    antwoord.writeHead(404);
    antwoord.end();
    return;
  }
  antwoord.writeHead(200, { 'content-type': TYPES[extname(bestand)] ?? 'text/plain' });
  antwoord.end(readFileSync(bestand));
}).listen(WEB);

const browser = BROWSERS.find(existsSync);
if (!browser) throw new Error('Chrome of Edge niet gevonden');
const proces = spawn(browser, ['--headless=new', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'winstje-test-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let fouten = 0;
const check = (naam, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FOUT'} ${naam} ${ok ? '' : extra}`);
  if (!ok) fouten += 1;
};
const wacht = (ms) => new Promise((r) => { setTimeout(r, ms); });

try {
  let doelen;
  for (let i = 0; i < 50 && !doelen; i += 1) {
    await wacht(200);
    doelen = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const open = new Map();
  const scriptfouten = [];
  ws.onmessage = (m) => {
    const b = JSON.parse(m.data);
    if (b.id) { open.get(b.id)(b.result); open.delete(b.id); }
    else if (b.method === 'Runtime.exceptionThrown') scriptfouten.push(b.params.exceptionDetails.exception?.description ?? b.params.exceptionDetails.text);
  };
  const cdp = (method, params = {}) => new Promise((r) => { id += 1; open.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (code) => {
    const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? code);
    return result.value;
  };
  const klik = (s) => ev(`document.querySelector(${JSON.stringify(s)}).click()`);
  const zet = (s, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(s)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  const tekst = (s) => ev(`document.querySelector(${JSON.stringify(s)})?.textContent.replace(/\\s+/g,' ').trim()`);
  const geenZijscroll = () => ev('document.documentElement.scrollWidth <= innerWidth');
  mkdirSync(FOTO_MAP, { recursive: true });
  const foto = async (naam) => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(FOTO_MAP, naam), Buffer.from(data, 'base64'));
  };

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${WEB}/` });
  await wacht(1200);

  // Vaste testgegevens: twee verkocht, twee in voorraad.
  await ev(`(async()=>{
    const db = await import('./db.js');
    const j = new Date().getFullYear();
    const svg = (b,h,c) => 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+b+'" height="'+h+'"><rect width="'+b+'" height="'+h+'" fill="#111"/><rect y="'+h*.3+'" width="'+b+'" height="'+h*.4+'" fill="'+c+'"/></svg>');
    const basis = { categorie:'', merk:'', maat:'', inkoopbron:'', notitie:'', foto:null };
    await db.bewaarArtikel({ ...basis, id:'a1', aangemaakt:'2026-01-01', naam:'Roze vest', status:'verkocht', inkoopprijs:500, inkoopdatum:j+'-01-02', verkoopprijs:2000, verkoopdatum:j+'-02-03', kosten:0, foto:svg(415,900,'#e8467c') });
    await db.bewaarArtikel({ ...basis, id:'a2', aangemaakt:'2026-01-02', naam:'Donkerblauwe jas', status:'voorraad', inkoopprijs:1500, inkoopdatum:j+'-01-05' });
    await db.bewaarArtikel({ ...basis, id:'a3', aangemaakt:'2026-01-03', naam:'Enkelgewichten', status:'verkocht', inkoopprijs:500, inkoopdatum:j+'-01-02', verkoopprijs:1000, verkoopdatum:j+'-02-10', kosten:0 });
    await db.bewaarArtikel({ ...basis, id:'a4', aangemaakt:'2026-01-04', naam:'Western blouse', status:'te_koop', inkoopprijs:500, inkoopdatum:j+'-01-06' });
  })()`);
  await cdp('Page.reload');
  await wacht(1500);

  // Nieuw artikel
  await klik('.fab');
  await wacht(400);
  check('nieuw artikel start op Gekocht', await ev(`document.getElementById('st-gekocht').checked`));
  await zet('#formulier [name=naam]', 'Onderweg jas');
  await zet('#formulier [name=inkoopprijs]', '10,00');
  await ev(`document.getElementById('formulier').requestSubmit()`);
  await wacht(900);
  check('gekocht artikel staat in de lijst', (await tekst('.kaart')).includes('Gekocht'));

  // Sorteren en raster
  await zet('#sortering', 'prijs_hoog');
  await wacht(300);
  check('sorteren op aankoopprijs', (await tekst('.kaart strong')) === 'Donkerblauwe jas');
  await klik('[data-weergave="raster"]');
  await wacht(600);
  check('raster toont vierkante tegels', await ev(`(()=>{const r=document.querySelector('.tegel-foto').getBoundingClientRect();return Math.abs(r.width-r.height)<1})()`));
  check('artikelscherm past op telefoon', await geenZijscroll());
  await foto('artikelen.png');

  // Overzicht
  await klik('[data-tab="overzicht"]');
  await wacht(1100);
  // Verkocht: kosten 1000, opbrengst 3000, dus +200%.
  check('winst op kosten in het jaaroverzicht', (await tekst('.hero-rij')).includes('+200%'), await tekst('.hero-rij'));
  const stand = await tekst('.totaal-rij.stand strong');
  // Opbrengst 3000 min inkoop 500+1500+500+500+1000 = 4000, dus -10,00.
  check('huidige stand', stand.includes('10,00') && stand.includes('-'), stand);
  const verwachtBlok = await ev(`[...document.querySelectorAll('.subkop')].find(h=>h.textContent==='Verwachte winst').nextElementSibling.textContent.replace(/\\s+/g,' ')`);
  // Voorraad 1500 + 500 + 1000 = 3000 tegen 200% is 6000 winst.
  check('verwachte winst', verwachtBlok.includes('60,00') && verwachtBlok.includes('+200%') && verwachtBlok.includes('3 artikelen'), verwachtBlok);
  await ev(`document.querySelector('.totaal-rij.stand').scrollIntoView({block:'center'})`);
  await wacht(300);
  await foto('stand.png');

  // Extra kosten tellen mee in de stand en het percentage
  await klik('[data-actie="nieuweKosten"]');
  await wacht(300);
  await zet('#kosten-formulier [name=naam]', 'Boosten');
  await zet('#kosten-formulier [name=bedrag]', '5,00');
  await ev(`document.getElementById('kosten-formulier').requestSubmit()`);
  await wacht(1300);
  check('extra kosten verlagen de stand', (await tekst('.totaal-rij.stand strong')).includes('15,00'));
  // Winst 2000 - 500 = 1500 op kosten 1500: +100%.
  check('extra kosten verlagen het percentage', (await tekst('.hero-rij')).includes('+100%'), await tekst('.hero-rij'));

  // Grafieken
  await ev(`(()=>{const s=document.getElementById('grafiek-slider');s.scrollIntoView({block:'center'});s.scrollLeft=2*s.clientWidth})()`);
  await wacht(500);
  check('swipen naar de kostengrafiek', (await tekst('[data-dia][aria-pressed=true]')) === 'Kosten');
  check('overzicht past op telefoon', await geenZijscroll());

  // Licht thema
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await ev(`document.querySelector('.hero').scrollIntoView()`);
  await wacht(300);
  await foto('overzicht-licht.png');

  check('geen scriptfouten', scriptfouten.length === 0, scriptfouten.join(' | '));
} catch (e) {
  fouten += 1;
  console.log('FOUT', e.message);
} finally {
  proces.kill();
  server.close();
}
console.log(fouten ? `${fouten} fout(en)` : `alles ok (schermafdrukken in ${FOTO_MAP})`);
process.exit(fouten ? 1 : 0);
