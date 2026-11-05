// Tekent de app-iconen met Chrome: `npm run icons`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const POORT = 9345;

const ster = (x, y, r) => `M${x} ${y - r}Q${x + r * 0.14} ${y - r * 0.14} ${x + r} ${y}Q${x + r * 0.14} ${y + r * 0.14} ${x} ${y + r}Q${x - r * 0.14} ${y + r * 0.14} ${x - r} ${y}Q${x - r * 0.14} ${y - r * 0.14} ${x} ${y - r}Z`;

/** `schaal` houdt de tekening binnen de veilige zone; `hoek` is de afronding van de achtergrond. */
function icoon(grootte, { schaal, hoek }) {
  const verschuif = 256 * (1 - schaal);
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:block" width="${grootte}" height="${grootte}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="achter" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a0ca3"/>
      <stop offset=".45" stop-color="#7b1fe0"/>
      <stop offset=".78" stop-color="#ec3f85"/>
      <stop offset="1" stop-color="#ff9150"/>
    </linearGradient>
    <radialGradient id="gloed" cx=".28" cy=".2" r=".62">
      <stop offset="0" stop-color="#fff" stop-opacity=".34"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warm" cx=".9" cy=".95" r=".6">
      <stop offset="0" stop-color="#ffd166" stop-opacity=".55"/>
      <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="kaart" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="1" stop-color="#f3e8ff"/>
    </linearGradient>
    <linearGradient id="euro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#ec3f85"/>
    </linearGradient>
    <linearGradient id="goud" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3c4"/>
      <stop offset="1" stop-color="#ffc53d"/>
    </linearGradient>
    <filter id="schaduw" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#25005e" flood-opacity=".5"/>
    </filter>
    <clipPath id="vorm"><rect width="512" height="512" rx="${hoek}"/></clipPath>
  </defs>
  <g clip-path="url(#vorm)">
    <rect width="512" height="512" fill="url(#achter)"/>
    <rect width="512" height="512" fill="url(#warm)"/>
    <rect width="512" height="512" fill="url(#gloed)"/>
    <g transform="translate(${verschuif} ${verschuif}) scale(${schaal})">
      <g transform="rotate(14 256 262)" filter="url(#schaduw)">
        <path fill="url(#kaart)" fill-rule="evenodd" stroke="url(#kaart)" stroke-width="18" stroke-linejoin="round"
          d="M256 76L358 178Q370 190 370 208V392Q370 436 326 436H186Q142 436 142 392V208Q142 190 154 178ZM256 140a30 30 0 1 0 .01 0Z"/>
        <g fill="none" stroke="url(#euro)" stroke-linecap="round">
          <path stroke-width="30" d="M318 264A72 72 0 1 0 318 368"/>
          <path stroke-width="24" d="M176 298H282M176 336H270"/>
        </g>
      </g>
      <path fill="url(#goud)" d="${ster(418, 112, 50)}"/>
      <path fill="url(#goud)" d="${ster(96, 150, 30)}"/>
      <path fill="url(#goud)" opacity=".9" d="${ster(430, 402, 24)}"/>
    </g>
  </g>
</svg>`;
}

const ICONEN = [
  ['icons/icon-192.png', 192, { schaal: 0.86, hoek: 112 }],
  ['icons/icon-512.png', 512, { schaal: 0.86, hoek: 112 }],
  // Android snijdt deze zelf bij, dus zonder hoeken en met ruimte rondom.
  ['icons/icon-maskable-512.png', 512, { schaal: 0.76, hoek: 0 }],
];

const browser = BROWSERS.find(existsSync);
if (!browser) throw new Error('Chrome of Edge niet gevonden');

const proces = spawn(browser, ['--headless=new', `--remote-debugging-port=${POORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'winstje-icoon-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });

try {
  let doelen;
  for (let i = 0; i < 50 && !doelen; i += 1) {
    await new Promise((r) => { setTimeout(r, 200); });
    doelen = await fetch(`http://127.0.0.1:${POORT}/json`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(doelen.find((d) => d.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const open = new Map();
  ws.onmessage = (m) => {
    const b = JSON.parse(m.data);
    if (b.id) { open.get(b.id)(b.result); open.delete(b.id); }
  };
  const cdp = (method, params = {}) => new Promise((r) => { id += 1; open.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

  await cdp('Page.enable');
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  mkdirSync('icons', { recursive: true });

  for (const [pad, grootte, opties] of ICONEN) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: grootte, height: grootte, deviceScaleFactor: 1, mobile: false });
    const html = `<!doctype html><html style="margin:0;overflow:hidden;background:transparent"><body style="margin:0;background:transparent">${icoon(grootte, opties)}</body></html>`;
    await cdp('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    await new Promise((r) => { setTimeout(r, 400); });
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(pad, Buffer.from(data, 'base64'));
    console.log(pad);
  }
} finally {
  proces.kill();
}
process.exit(0);
