import { alleArtikelen, bewaarArtikel, verwijderArtikel, vervangAlles } from './db.js';
import { isGekoppeld, huidigAccount, inloggen, registreren, uitloggen, syncNu, foutTekst } from './account.js';
import {
  STATUSSEN, parseEuro, formatEuro, euroInvoer, winst, vandaagIso, dagenTussen, formatDatum,
  beschikbareJaren, jaarOverzicht, blijvenLiggen, naarCsv,
} from './logic.js';

const CATEGORIEEN = ['Kleding', 'Schoenen', 'Tassen', 'Accessoires', 'Sieraden', 'Overig'];
const BRONNEN = ['Vinted', 'Kringloop', 'Marktplaats', 'Rommelmarkt', 'Winkel'];
const MELDGRENS_VERKOPEN = 30;
const MELDGRENS_OMZET = 200000;
const GRAFIEK_HOOGTE = 130;

const staat = {
  tab: 'artikelen',
  filter: 'alles',
  zoek: '',
  jaar: new Date().getFullYear(),
  artikelen: [],
  installatie: null,
  concept: null,
  account: null,
  syncStatus: null,
};

const view = document.getElementById('view');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');
const backupBestand = document.getElementById('backup-bestand');
const minderBeweging = matchMedia('(prefers-reduced-motion: reduce)');

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const klasseBedrag = (centen) => (centen < 0 ? 'min' : 'plus');
const metTeken = (centen) => `${centen > 0 ? '+' : ''}${formatEuro(centen)}`;

function toon(tekst) {
  toastEl.textContent = tekst;
  toastEl.classList.add('zichtbaar');
  clearTimeout(toon.timer);
  toon.timer = setTimeout(() => toastEl.classList.remove('zichtbaar'), 2400);
}

function telOp(el, doel) {
  if (minderBeweging.matches || doel === 0) {
    el.textContent = formatEuro(doel);
    return;
  }
  const start = performance.now();
  const stap = (nu) => {
    const t = Math.min((nu - start) / 800, 1);
    el.textContent = formatEuro(Math.round(doel * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(stap);
  };
  requestAnimationFrame(stap);
}

function confetti() {
  if (minderBeweging.matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  // In een open dialoog zou de canvas eronder vallen, dus die is dan al gesloten.
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const { innerWidth: b, innerHeight: h } = window;
  canvas.width = b;
  canvas.height = h;
  const kleuren = ['#6d28d9', '#e8467c', '#ff7a59', '#ffc53d', '#2dd4a7'];
  const stukjes = Array.from({ length: 130 }, (_, i) => ({
    x: b / 2,
    y: h * 0.32,
    vx: (Math.random() - 0.5) * 15,
    vy: Math.random() * -14 - 3,
    grootte: Math.random() * 7 + 5,
    hoek: Math.random() * 6,
    draai: (Math.random() - 0.5) * 0.4,
    kleur: kleuren[i % kleuren.length],
  }));
  const start = performance.now();
  const teken = (nu) => {
    const tijd = nu - start;
    ctx.clearRect(0, 0, b, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, (2400 - tijd) / 700));
    for (const s of stukjes) {
      s.vy += 0.38;
      s.vx *= 0.985;
      s.x += s.vx;
      s.y += s.vy;
      s.hoek += s.draai;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.hoek);
      ctx.fillStyle = s.kleur;
      ctx.fillRect(-s.grootte / 2, -s.grootte / 3, s.grootte, s.grootte * 0.66);
      ctx.restore();
    }
    if (tijd < 2400) requestAnimationFrame(teken);
    else canvas.remove();
  };
  requestAnimationFrame(teken);
}

/* Schermen */

function render() {
  document.querySelectorAll('.nav-knop').forEach((knop) => {
    if (knop.dataset.tab === staat.tab) knop.setAttribute('aria-current', 'page');
    else knop.removeAttribute('aria-current');
  });
  ({ artikelen: renderArtikelen, overzicht: renderOverzicht, meer: renderMeer })[staat.tab]();
}

function renderArtikelen() {
  const jaar = new Date().getFullYear();
  const o = jaarOverzicht(staat.artikelen, jaar);
  const filters = { alles: 'Alles', ...STATUSSEN };

  view.innerHTML = `
    <section class="scherm">
      <div class="hero">
        <p class="hero-label">Winst in ${jaar}</p>
        <p class="hero-bedrag" id="hero-bedrag">${formatEuro(0)}</p>
        <div class="hero-rij">
          <div><strong>${o.verkocht}</strong><small>verkocht</small></div>
          <div><strong>${o.voorraadAantal}</strong><small>in voorraad</small></div>
          <div><strong>${formatEuro(o.voorraadWaarde)}</strong><small>waarde</small></div>
        </div>
      </div>
      <input class="zoek" id="zoek" type="search" placeholder="Zoek op naam, merk of categorie" aria-label="Zoeken" value="${esc(staat.zoek)}">
      <div class="chips">
        ${Object.entries(filters).map(([sleutel, naam]) => `
          <button class="chip" data-filter="${sleutel}" aria-pressed="${staat.filter === sleutel}">${naam}</button>`).join('')}
      </div>
      <div class="lijst" id="lijst"></div>
    </section>`;

  telOp(document.getElementById('hero-bedrag'), o.winst);
  renderLijst();
}

function zichtbareArtikelen() {
  const zoek = staat.zoek.trim().toLowerCase();
  return staat.artikelen
    .filter((a) => staat.filter === 'alles' || a.status === staat.filter)
    .filter((a) => !zoek || [a.naam, a.merk, a.categorie, a.maat].some((v) => v?.toLowerCase().includes(zoek)))
    .sort((x, y) => (y.aangemaakt ?? '').localeCompare(x.aangemaakt ?? ''));
}

function kaartHtml(a, i) {
  const w = winst(a);
  const details = [STATUSSEN[a.status], a.merk, a.maat].filter(Boolean).join(' · ');
  const bedrag = w === null
    ? `${formatEuro(a.inkoopprijs)}<small>ingekocht</small>`
    : `<span class="${klasseBedrag(w)}">${metTeken(w)}</span><small>winst</small>`;
  return `
    <button class="kaart" style="--i:${i}" data-actie="open" data-id="${esc(a.id)}">
      <span class="thumb">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : esc(a.naam.charAt(0).toUpperCase())}</span>
      <span class="kaart-tekst"><strong>${esc(a.naam)}</strong><small>${esc(details)}</small></span>
      <span class="kaart-bedrag">${bedrag}</span>
    </button>`;
}

function renderLijst() {
  const lijst = document.getElementById('lijst');
  const artikelen = zichtbareArtikelen();
  if (artikelen.length) {
    lijst.innerHTML = artikelen.map(kaartHtml).join('');
  } else if (staat.artikelen.length) {
    lijst.innerHTML = '<div class="leeg"><h3>Niets gevonden</h3><p>Probeer een andere zoekterm of filter.</p></div>';
  } else {
    lijst.innerHTML = `
      <div class="leeg">
        <div class="leeg-icoon" aria-hidden="true">🛍️</div>
        <h3>Nog geen artikelen</h3>
        <p>Tik op de plus om je eerste aankoop toe te voegen.</p>
      </div>`;
  }
}

function grafiekHtml(o) {
  const grootste = Math.max(1, ...o.maanden.map((m) => Math.abs(m.winst)));
  const heeftVerlies = o.maanden.some((m) => m.winst < 0);
  const hoog = heeftVerlies ? GRAFIEK_HOOGTE * 0.72 : GRAFIEK_HOOGTE;
  const laag = heeftVerlies ? GRAFIEK_HOOGTE * 0.28 : 0;
  // De schaal is gelijk boven en onder de nullijn; een groot verlies past dan binnen het onderste deel.
  const grootsteVerlies = Math.max(0, ...o.maanden.map((m) => -m.winst));
  const schaal = Math.min(hoog / grootste, grootsteVerlies ? laag / grootsteVerlies : Infinity);

  return o.maanden.map((m, i) => {
    const px = Math.abs(m.winst) * schaal;
    const staaf = `<span class="staaf" style="--h:${px.toFixed(1)}px;--i:${i}"></span>`;
    return `
      <button class="kolom" style="--hoog:${hoog}px;--laag:${laag}px" data-maand="${i}" aria-pressed="false"
        aria-label="${m.naam}: ${formatEuro(m.winst)} winst, ${m.aantal} verkocht">
        <span class="kolom-boven">${m.winst > 0 ? staaf : ''}</span>
        <span class="kolom-onder">${m.winst < 0 ? staaf : ''}</span>
        <span class="kolom-naam">${m.naam.charAt(0).toUpperCase()}</span>
      </button>`;
  }).join('');
}

function meterHtml(label, waarde, tekst, grens) {
  const procent = Math.min(100, (waarde / grens) * 100);
  return `
    <div class="meter">
      <div class="meter-kop"><span>${label}</span><strong>${tekst}</strong></div>
      <div class="meter-balk"><span style="--p:${procent}%"></span></div>
    </div>`;
}

function renderOverzicht() {
  const huidigJaar = new Date().getFullYear();
  const vandaag = vandaagIso();
  const o = jaarOverzicht(staat.artikelen, staat.jaar);
  const jaren = beschikbareJaren(staat.artikelen, huidigJaar);
  const liggen = blijvenLiggen(staat.artikelen, vandaag);
  const maandRegels = o.maanden.filter((m) => m.aantal);

  view.innerHTML = `
    <section class="scherm">
      <h1 class="titel">Overzicht</h1>
      <div class="chips jaren">
        ${jaren.map((j) => `<button class="chip" data-jaar="${j}" aria-pressed="${j === staat.jaar}">${j}</button>`).join('')}
      </div>
      <div class="hero">
        <p class="hero-label">Winst in ${staat.jaar}</p>
        <p class="hero-bedrag" id="hero-bedrag">${formatEuro(0)}</p>
        <div class="hero-rij">
          <div><strong>${formatEuro(o.omzet)}</strong><small>omzet</small></div>
          <div><strong>${o.verkocht}</strong><small>verkocht</small></div>
        </div>
      </div>
      <div class="tegels">
        <div class="tegel"><strong>${formatEuro(o.ingekocht)}</strong><small>ingekocht in ${staat.jaar}</small></div>
        <div class="tegel"><strong>${formatEuro(o.kosten)}</strong><small>kosten</small></div>
        <div class="tegel"><strong>${formatEuro(o.voorraadWaarde)}</strong><small>voorraadwaarde nu</small></div>
        <div class="tegel"><strong>${o.verkocht ? formatEuro(Math.round(o.winst / o.verkocht)) : '–'}</strong><small>winst per verkoop</small></div>
      </div>

      <h2 class="subkop">Winst per maand</h2>
      <div class="paneel">
        <p class="grafiek-info" id="grafiek-info">Tik op een maand voor de details.</p>
        <div class="grafiek">${grafiekHtml(o)}</div>
        ${maandRegels.length ? `
          <details>
            <summary>Toon als tabel</summary>
            <table>
              <thead><tr><th>Maand</th><th>Verkocht</th><th>Omzet</th><th>Winst</th></tr></thead>
              <tbody>${maandRegels.map((m) => `
                <tr><td>${m.naam}</td><td>${m.aantal}</td><td>${formatEuro(m.omzet)}</td><td>${formatEuro(m.winst)}</td></tr>`).join('')}
              </tbody>
            </table>
          </details>` : ''}
      </div>

      <h2 class="subkop">Meldgrens Vinted</h2>
      <div class="paneel">
        ${meterHtml('Verkopen', o.verkocht, `${o.verkocht} van ${MELDGRENS_VERKOPEN}`, MELDGRENS_VERKOPEN)}
        ${meterHtml('Omzet', o.omzet, `${formatEuro(o.omzet)} van ${formatEuro(MELDGRENS_OMZET)}`, MELDGRENS_OMZET)}
        <p class="klein" style="margin-top:12px">Boven een van deze grenzen in een jaar geeft Vinted je gegevens door aan de Belastingdienst.</p>
      </div>

      ${liggen.length ? `
        <h2 class="subkop">Blijven liggen</h2>
        <p class="klein" style="margin-bottom:10px">Al minstens 60 dagen in huis. Misschien tijd voor een lagere prijs?</p>
        <div class="lijst">
          ${liggen.slice(0, 5).map((a, i) => `
            <button class="kaart" style="--i:${i}" data-actie="open" data-id="${esc(a.id)}">
              <span class="thumb">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : esc(a.naam.charAt(0).toUpperCase())}</span>
              <span class="kaart-tekst"><strong>${esc(a.naam)}</strong><small>${dagenTussen(a.inkoopdatum, vandaag)} dagen</small></span>
              <span class="kaart-bedrag">${formatEuro(a.inkoopprijs)}</span>
            </button>`).join('')}
        </div>` : ''}
    </section>`;

  telOp(document.getElementById('hero-bedrag'), o.winst);
}

function accountHtml() {
  if (staat.account) {
    const status = staat.syncStatus === 'fout'
      ? 'Nog niet alles is online bewaard. Dat gebeurt vanzelf zodra het weer lukt.'
      : 'Je gegevens worden automatisch online bewaard.';
    return `
      <p class="melding"><strong>${esc(staat.account.email)}</strong><br>${status}</p>`;
  }
  return `
    <p class="melding"><strong>Let op:</strong> je gegevens staan alleen op dit toestel.
    ${isGekoppeld() ? 'Log in om ze online te bewaren.' : 'Maak regelmatig een back-up, zodat je niets kwijtraakt.'}</p>`;
}

function renderMeer() {
  view.innerHTML = `
    <section class="scherm">
      <h1 class="titel">Meer</h1>
      ${accountHtml()}
      <div class="acties">
        ${isGekoppeld() && !staat.account ? `
          <button class="actie" data-actie="login"><span aria-hidden="true">☁️</span><span><strong>Inloggen</strong><small>Bewaar alles veilig online</small></span></button>` : ''}
        ${staat.installatie ? `
          <button class="actie" data-actie="installeer"><span aria-hidden="true">📲</span><span><strong>Installeer de app</strong><small>Zet Winstje tussen je andere apps</small></span></button>` : ''}
        <button class="actie" data-actie="csv"><span aria-hidden="true">📊</span><span><strong>Exporteren naar Excel</strong><small>Alle artikelen als CSV-bestand</small></span></button>
        <button class="actie" data-actie="backup"><span aria-hidden="true">💾</span><span><strong>Back-up maken</strong><small>Alles inclusief foto's</small></span></button>
        <button class="actie" data-actie="herstel"><span aria-hidden="true">♻️</span><span><strong>Back-up terugzetten</strong><small>Vervangt alles wat nu in de app staat</small></span></button>
        ${staat.account ? `
          <button class="actie" data-actie="sync"><span aria-hidden="true">🔄</span><span><strong>Nu synchroniseren</strong><small>Haal de laatste wijzigingen op</small></span></button>
          <button class="actie" data-actie="uitloggen"><span aria-hidden="true">👋</span><span><strong>Uitloggen</strong><small>Je gegevens blijven op dit toestel staan</small></span></button>` : ''}
      </div>
      <p class="klein" style="margin-top:18px;text-align:center">${staat.artikelen.length} artikelen opgeslagen</p>
    </section>`;
}

/* Artikel toevoegen of wijzigen */

function veldHtml(naam, label, waarde = '', extra = '') {
  return `
    <label class="veld"><span>${label}</span>
      <input name="${naam}" value="${esc(waarde)}" ${extra}>
      <small class="fout" data-fout="${naam}" hidden></small>
    </label>`;
}

function openFormulier(artikel) {
  const a = artikel ?? { status: 'voorraad', inkoopdatum: vandaagIso() };
  staat.concept = { id: artikel?.id ?? null, foto: a.foto ?? null };
  const eigenWaarden = (veld) => staat.artikelen.map((x) => x[veld]).filter(Boolean);
  const opties = (lijst) => [...new Set(lijst)].map((o) => `<option value="${esc(o)}"></option>`).join('');

  sheet.innerHTML = `
    <div class="sheet-greep"></div>
    <div class="sheet-kop">
      <h2>${artikel ? 'Artikel' : 'Nieuw artikel'}</h2>
      <button class="sluit" type="button" data-actie="sluit" aria-label="Sluiten">✕</button>
    </div>
    <form id="formulier" novalidate>
      <div class="form">
        <label class="foto-knop">
          <span id="foto-tekst" ${a.foto ? 'hidden' : ''}>📷 Foto toevoegen</span>
          <img id="foto-voorbeeld" alt="" ${a.foto ? `src="${esc(a.foto)}"` : 'hidden'}>
          <input id="foto" type="file" accept="image/*">
        </label>
        ${veldHtml('naam', 'Naam', a.naam, 'autocomplete="off" required')}
        <div class="twee">
          ${veldHtml('categorie', 'Categorie', a.categorie, 'list="lijst-categorie" autocomplete="off"')}
          ${veldHtml('merk', 'Merk', a.merk, 'autocomplete="off"')}
        </div>
        <div class="twee">
          ${veldHtml('maat', 'Maat', a.maat, 'autocomplete="off"')}
          ${veldHtml('inkoopbron', 'Gekocht bij', a.inkoopbron, 'list="lijst-bron" autocomplete="off"')}
        </div>
        <div class="twee">
          ${veldHtml('inkoopprijs', 'Inkoopprijs (€)', euroInvoer(a.inkoopprijs), 'inputmode="decimal" autocomplete="off" placeholder="0,00"')}
          ${veldHtml('inkoopdatum', 'Inkoopdatum', a.inkoopdatum, 'type="date"')}
        </div>
        <div class="seg" role="radiogroup" aria-label="Status">
          <span class="seg-duim"></span>
          ${Object.entries(STATUSSEN).map(([sleutel, naam]) => `
            <input type="radio" id="st-${sleutel}" name="status" value="${sleutel}" ${a.status === sleutel ? 'checked' : ''}>
            <label for="st-${sleutel}">${naam}</label>`).join('')}
        </div>
        <div class="verkoop-velden" id="verkoop-velden" ${a.status === 'verkocht' ? '' : 'hidden'}>
          <div class="twee">
            ${veldHtml('verkoopprijs', 'Verkoopprijs (€)', euroInvoer(a.verkoopprijs), 'inputmode="decimal" autocomplete="off" placeholder="0,00"')}
            ${veldHtml('verkoopdatum', 'Verkoopdatum', a.verkoopdatum ?? vandaagIso(), 'type="date"')}
          </div>
          ${veldHtml('kosten', 'Kosten, bijv. verzending (€)', euroInvoer(a.kosten || null), 'inputmode="decimal" autocomplete="off" placeholder="0,00"')}
          <div class="live-winst"><span>Winst</span><strong id="live-winst"></strong></div>
        </div>
        <label class="veld"><span>Notitie</span><textarea name="notitie" rows="2">${esc(a.notitie)}</textarea></label>
        <datalist id="lijst-categorie">${opties([...CATEGORIEEN, ...eigenWaarden('categorie')])}</datalist>
        <datalist id="lijst-bron">${opties([...BRONNEN, ...eigenWaarden('inkoopbron')])}</datalist>
      </div>
      <div class="sheet-voet">
        ${artikel ? '<button class="knop-weg" type="button" data-actie="verwijder">Verwijderen</button>' : ''}
        <button class="knop" type="submit">Bewaren</button>
      </div>
    </form>`;

  sheet.showModal();
  sheet.scrollTop = 0;
  history.pushState({ sheet: true }, '');
  werkLiveWinstBij();
}

function openLogin() {
  sheet.innerHTML = `
    <div class="sheet-greep"></div>
    <div class="sheet-kop">
      <h2>Inloggen</h2>
      <button class="sluit" type="button" data-actie="sluit" aria-label="Sluiten">✕</button>
    </div>
    <form id="login" novalidate>
      <div class="form">
        <p class="klein">Met een account staan je gegevens veilig online en kun je ze terughalen op een nieuwe telefoon.</p>
        <label class="veld"><span>E-mailadres</span>
          <input name="email" type="email" autocomplete="username" inputmode="email">
        </label>
        <label class="veld"><span>Wachtwoord</span>
          <input name="wachtwoord" type="password" autocomplete="current-password">
        </label>
        <small class="fout" id="login-fout" role="alert" hidden></small>
      </div>
      <div class="sheet-voet">
        <button class="knop-tweede" type="button" data-actie="registreer">Account maken</button>
        <button class="knop" type="submit">Inloggen</button>
      </div>
    </form>`;
  sheet.showModal();
  history.pushState({ sheet: true }, '');
}

async function verwerkLogin(actie) {
  const form = document.getElementById('login');
  const fout = document.getElementById('login-fout');
  const email = form.email.value.trim();
  const wachtwoord = form.wachtwoord.value;
  fout.hidden = true;
  if (!email || !wachtwoord) {
    fout.textContent = 'Vul je e-mailadres en wachtwoord in';
    fout.hidden = false;
    return;
  }
  form.querySelectorAll('button').forEach((k) => { k.disabled = true; });
  try {
    const account = await actie(email, wachtwoord);
    sluitFormulier();
    if (account) {
      staat.account = account;
      toon('Ingelogd');
      await synchroniseerNu();
    } else {
      toon('Bevestig je e-mailadres via de mail');
    }
    render();
  } catch (e) {
    fout.textContent = foutTekst(e);
    fout.hidden = false;
    form.querySelectorAll('button').forEach((k) => { k.disabled = false; });
  }
}

async function synchroniseerNu() {
  if (!staat.account) return;
  try {
    const binnen = await syncNu();
    staat.syncStatus = 'ok';
    if (binnen) staat.artikelen = await alleArtikelen();
    // Niet verversen terwijl er getypt wordt, anders verdwijnt de invoer.
    if (!sheet.open && document.activeElement?.id !== 'zoek' && (binnen || staat.tab === 'meer')) render();
  } catch {
    staat.syncStatus = 'fout';
    if (staat.tab === 'meer' && !sheet.open) render();
  }
}

function planSync() {
  clearTimeout(planSync.timer);
  planSync.timer = setTimeout(synchroniseerNu, 800);
}

function sluitFormulier() {
  if (history.state?.sheet) history.back();
  else sheet.close();
}

function werkLiveWinstBij() {
  const form = document.getElementById('formulier');
  const el = document.getElementById('live-winst');
  if (!form || !el) return;
  const w = winst({
    status: 'verkocht',
    inkoopprijs: parseEuro(form.inkoopprijs.value) || 0,
    verkoopprijs: parseEuro(form.verkoopprijs.value) || 0,
    kosten: parseEuro(form.kosten.value) || 0,
  });
  el.textContent = metTeken(w);
  el.className = klasseBedrag(w);
}

function zetFout(form, veld, tekst) {
  const fout = form.querySelector(`[data-fout="${veld}"]`);
  fout.textContent = tekst ?? '';
  fout.hidden = !tekst;
  if (tekst) form[veld].setAttribute('aria-invalid', 'true');
  else form[veld].removeAttribute('aria-invalid');
  return !tekst;
}

function leesBedrag(form, veld, verplicht) {
  const waarde = parseEuro(form[veld].value);
  if (Number.isNaN(waarde)) zetFout(form, veld, 'Vul een bedrag in, bijv. 12,50');
  else if (waarde === null && verplicht) zetFout(form, veld, 'Vul een bedrag in');
  else zetFout(form, veld);
  return waarde;
}

async function bewaarFormulier(form) {
  const status = form.status.value;
  const verkocht = status === 'verkocht';
  const naam = form.naam.value.trim();
  const inkoopprijs = leesBedrag(form, 'inkoopprijs', true);
  const verkoopprijs = verkocht ? leesBedrag(form, 'verkoopprijs', true) : null;
  const kosten = verkocht ? leesBedrag(form, 'kosten', false) : null;

  const naamOk = zetFout(form, 'naam', naam ? null : 'Geef het artikel een naam');
  const datumOk = zetFout(form, 'inkoopdatum', form.inkoopdatum.value ? null : 'Kies een datum');
  const verkoopdatumOk = zetFout(form, 'verkoopdatum', !verkocht || form.verkoopdatum.value ? null : 'Kies een datum');
  const bedragenOk = [inkoopprijs, verkoopprijs, kosten].every((b) => !Number.isNaN(b))
    && inkoopprijs !== null && (!verkocht || verkoopprijs !== null);

  if (!naamOk || !datumOk || !verkoopdatumOk || !bedragenOk) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const bestaand = staat.artikelen.find((a) => a.id === staat.concept.id);
  const artikel = {
    id: bestaand?.id ?? crypto.randomUUID(),
    aangemaakt: bestaand?.aangemaakt ?? new Date().toISOString(),
    naam,
    categorie: form.categorie.value.trim(),
    merk: form.merk.value.trim(),
    maat: form.maat.value.trim(),
    inkoopbron: form.inkoopbron.value.trim(),
    inkoopprijs,
    inkoopdatum: form.inkoopdatum.value,
    status,
    verkoopprijs,
    verkoopdatum: verkocht ? form.verkoopdatum.value : null,
    kosten: verkocht ? kosten ?? 0 : null,
    notitie: form.notitie.value.trim(),
    foto: staat.concept.foto,
  };

  try {
    await bewaarArtikel(artikel);
  } catch {
    toon('Opslaan is niet gelukt');
    return;
  }

  staat.artikelen = await alleArtikelen();
  sluitFormulier();
  render();
  planSync();

  if (verkocht && bestaand?.status !== 'verkocht') {
    const w = winst(artikel);
    toon(`Verkocht! ${metTeken(w)} winst`);
    if (w > 0) confetti();
  } else {
    toon('Bewaard');
  }
}

async function verkleinFoto(bestand) {
  const beeld = await createImageBitmap(bestand);
  const schaal = Math.min(1, 900 / Math.max(beeld.width, beeld.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(beeld.width * schaal);
  canvas.height = Math.round(beeld.height * schaal);
  canvas.getContext('2d').drawImage(beeld, 0, 0, canvas.width, canvas.height);
  beeld.close();
  return canvas.toDataURL('image/jpeg', 0.78);
}

/* Export en back-up */

function download(naam, inhoud, type) {
  const url = URL.createObjectURL(new Blob([inhoud], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = naam;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function zetBackupTerug(bestand) {
  let artikelen;
  try {
    artikelen = JSON.parse(await bestand.text());
  } catch {
    artikelen = null;
  }
  if (!Array.isArray(artikelen) || !artikelen.every((a) => a?.id && a?.naam && STATUSSEN[a.status])) {
    toon('Dit is geen geldige back-up');
    return;
  }
  if (!confirm(`${artikelen.length} artikelen terugzetten? Alles wat nu in de app staat wordt vervangen.`)) return;
  await vervangAlles(artikelen);
  staat.artikelen = await alleArtikelen();
  render();
  planSync();
  toon('Back-up teruggezet');
}

/* Bediening */

const acties = {
  nieuw: () => openFormulier(),
  open: (knop) => openFormulier(staat.artikelen.find((a) => a.id === knop.dataset.id)),
  sluit: sluitFormulier,
  async verwijder() {
    if (!confirm('Dit artikel verwijderen?')) return;
    await verwijderArtikel(staat.concept.id);
    staat.artikelen = await alleArtikelen();
    sluitFormulier();
    render();
    planSync();
    toon('Verwijderd');
  },
  login: openLogin,
  registreer: () => verwerkLogin(registreren),
  async sync() {
    await synchroniseerNu();
    toon(staat.syncStatus === 'ok' ? 'Alles is bijgewerkt' : 'Dat lukte niet, probeer het later nog eens');
  },
  async uitloggen() {
    if (!confirm('Uitloggen? Je gegevens blijven op dit toestel staan.')) return;
    await synchroniseerNu();
    try {
      await uitloggen();
    } catch {
      toon('Uitloggen lukte niet');
      return;
    }
    staat.account = null;
    staat.syncStatus = null;
    render();
  },
  csv: () => download(`winstje-${vandaagIso()}.csv`, naarCsv(staat.artikelen), 'text/csv;charset=utf-8'),
  backup: () => download(`winstje-backup-${vandaagIso()}.json`, JSON.stringify(staat.artikelen), 'application/json'),
  herstel: () => backupBestand.click(),
  async installeer() {
    await staat.installatie?.prompt();
    staat.installatie = null;
    render();
  },
};

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    staat.tab = tab.dataset.tab;
    scrollTo(0, 0);
    render();
    return;
  }

  const filter = e.target.closest('[data-filter]');
  if (filter) {
    staat.filter = filter.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', c === filter));
    renderLijst();
    return;
  }

  const jaar = e.target.closest('[data-jaar]');
  if (jaar) {
    staat.jaar = Number(jaar.dataset.jaar);
    render();
    return;
  }

  const kolom = e.target.closest('[data-maand]');
  if (kolom) {
    const m = jaarOverzicht(staat.artikelen, staat.jaar).maanden[kolom.dataset.maand];
    document.querySelectorAll('[data-maand]').forEach((k) => k.setAttribute('aria-pressed', k === kolom));
    document.getElementById('grafiek-info').innerHTML = `<strong>${m.naam}: ${formatEuro(m.winst)}</strong> winst, ${m.aantal} verkocht`;
    return;
  }

  const actie = e.target.closest('[data-actie]');
  if (actie) acties[actie.dataset.actie](actie);
});

view.addEventListener('input', (e) => {
  if (e.target.id === 'zoek') {
    staat.zoek = e.target.value;
    renderLijst();
  }
});

sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sluitFormulier();
});

sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  sluitFormulier();
});

sheet.addEventListener('input', werkLiveWinstBij);

sheet.addEventListener('change', async (e) => {
  if (e.target.name === 'status') {
    document.getElementById('verkoop-velden').hidden = e.target.value !== 'verkocht';
    werkLiveWinstBij();
  }
  if (e.target.id === 'foto' && e.target.files[0]) {
    try {
      staat.concept.foto = await verkleinFoto(e.target.files[0]);
      const voorbeeld = document.getElementById('foto-voorbeeld');
      voorbeeld.src = staat.concept.foto;
      voorbeeld.hidden = false;
      document.getElementById('foto-tekst').hidden = true;
    } catch {
      toon('Deze foto kan niet worden gelezen');
    }
  }
});

sheet.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'login') verwerkLogin(inloggen);
  else bewaarFormulier(e.target);
});

// De terugknop van Android sluit het formulier in plaats van de app.
addEventListener('popstate', () => {
  if (sheet.open) sheet.close();
});

backupBestand.addEventListener('change', () => {
  const bestand = backupBestand.files[0];
  backupBestand.value = '';
  if (bestand) zetBackupTerug(bestand);
});

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  staat.installatie = e;
  if (staat.tab === 'meer') render();
});

addEventListener('online', planSync);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') planSync();
});

async function start() {
  staat.artikelen = await alleArtikelen();
  render();
  staat.account = await huidigAccount();
  if (staat.tab === 'meer') render();
  planSync();
  navigator.storage?.persist?.();
  // Zonder service worker werkt de app gewoon, alleen niet offline.
  navigator.serviceWorker?.register('sw.js').catch(() => {});
}

start().catch(() => {
  view.innerHTML = '<div class="leeg"><h3>De app kon niet starten</h3><p>Je gegevens konden niet worden geladen.</p></div>';
});
