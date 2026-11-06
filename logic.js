// Rekenlogica zonder scherm of opslag, zodat die los te testen is.
// Alle bedragen zijn hele centen; zo ontstaan er geen afrondingsverschillen.

const euroFormat = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

export const STATUSSEN = {
  gekocht: 'Gekocht',
  voorraad: 'Voorraad',
  te_koop: 'Te koop',
  verkocht: 'Verkocht',
};

export const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Zet invoer als "12,50", "12.5" of "€ 1.250,00" om naar centen. Leeg = null, ongeldig = NaN. */
export function parseEuro(tekst) {
  let t = String(tekst ?? '').replace(/[€\s]/g, '');
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}

export function formatEuro(centen) {
  return euroFormat.format((centen ?? 0) / 100);
}

/** Bedrag voor in een invoerveld: 1250 wordt "12,50". */
export function euroInvoer(centen) {
  return centen == null ? '' : (centen / 100).toFixed(2).replace('.', ',');
}

/** Winst op een verkocht artikel, anders null. */
export function winst(a) {
  if (a.status !== 'verkocht') return null;
  return (a.verkoopprijs ?? 0) - (a.inkoopprijs ?? 0) - (a.kosten ?? 0);
}

/** Vandaag als JJJJ-MM-DD in lokale tijd. */
export function vandaagIso(nu = new Date()) {
  const m = String(nu.getMonth() + 1).padStart(2, '0');
  const d = String(nu.getDate()).padStart(2, '0');
  return `${nu.getFullYear()}-${m}-${d}`;
}

export function dagenTussen(vanIso, totIso) {
  return Math.round((Date.parse(totIso) - Date.parse(vanIso)) / 86400000);
}

export function formatDatum(iso) {
  if (!iso) return '';
  const [j, m, d] = iso.split('-').map(Number);
  return `${d} ${MAANDEN[m - 1]} ${j}`;
}

/** Jaren waarin iets is ingekocht of verkocht, nieuwste eerst; het huidige jaar staat er altijd bij. */
export function beschikbareJaren(artikelen, huidigJaar, extraKosten = []) {
  const jaren = new Set([huidigJaar]);
  for (const a of artikelen) {
    if (a.inkoopdatum) jaren.add(Number(a.inkoopdatum.slice(0, 4)));
    if (a.status === 'verkocht' && a.verkoopdatum) jaren.add(Number(a.verkoopdatum.slice(0, 4)));
  }
  for (const k of extraKosten) {
    if (k.datum) jaren.add(Number(k.datum.slice(0, 4)));
  }
  return [...jaren].sort((x, y) => y - x);
}

/** `winst` is na aftrek van de extra kosten die niet bij één artikel horen, zoals boosten. */
export function jaarOverzicht(artikelen, jaar, extraKosten = []) {
  const maanden = MAANDEN.map((naam) => ({ naam, aantal: 0, omzet: 0, winst: 0, extraKosten: 0 }));
  const uitkomst = { omzet: 0, winst: 0, kosten: 0, extraKosten: 0, verkocht: 0, ingekocht: 0, voorraadWaarde: 0, voorraadAantal: 0, maanden };

  for (const a of artikelen) {
    if (a.inkoopdatum?.startsWith(`${jaar}-`)) uitkomst.ingekocht += a.inkoopprijs ?? 0;

    if (a.status !== 'verkocht') {
      // Voorraad is een stand van nu en hoort dus niet bij een bepaald jaar.
      uitkomst.voorraadWaarde += a.inkoopprijs ?? 0;
      uitkomst.voorraadAantal += 1;
    } else if (a.verkoopdatum?.startsWith(`${jaar}-`)) {
      const w = winst(a);
      const maand = maanden[Number(a.verkoopdatum.slice(5, 7)) - 1];
      uitkomst.verkocht += 1;
      uitkomst.omzet += a.verkoopprijs ?? 0;
      uitkomst.kosten += a.kosten ?? 0;
      uitkomst.winst += w;
      maand.aantal += 1;
      maand.omzet += a.verkoopprijs ?? 0;
      maand.winst += w;
    }
  }

  for (const k of extraKosten) {
    if (!k.datum?.startsWith(`${jaar}-`)) continue;
    const maand = maanden[Number(k.datum.slice(5, 7)) - 1];
    uitkomst.extraKosten += k.bedrag;
    uitkomst.winst -= k.bedrag;
    maand.extraKosten += k.bedrag;
    maand.winst -= k.bedrag;
  }
  return uitkomst;
}

/** Stand over alle jaren samen. Voorraad telt tegen inkoopprijs, verkocht tegen verkoopprijs. */
export function totaalOverzicht(artikelen) {
  const uitkomst = { ingekocht: 0, opbrengst: 0, verkocht: 0, voorraadWaarde: 0, voorraadAantal: 0 };
  for (const a of artikelen) {
    uitkomst.ingekocht += a.inkoopprijs ?? 0;
    if (a.status === 'verkocht') {
      uitkomst.opbrengst += a.verkoopprijs ?? 0;
      uitkomst.verkocht += 1;
    } else {
      uitkomst.voorraadWaarde += a.inkoopprijs ?? 0;
      uitkomst.voorraadAantal += 1;
    }
  }
  return uitkomst;
}

/** Artikelen die binnen zijn, niet verkocht en al minstens `dagen` dagen in huis, oudste eerst. */
export function blijvenLiggen(artikelen, vandaag, dagen = 60) {
  return artikelen
    .filter((a) => !['verkocht', 'gekocht'].includes(a.status) && a.inkoopdatum && dagenTussen(a.inkoopdatum, vandaag) >= dagen)
    .sort((x, y) => x.inkoopdatum.localeCompare(y.inkoopdatum));
}

function csvVeld(waarde) {
  let t = String(waarde ?? '');
  // Excel zou tekst die zo begint als formule uitvoeren.
  if (/^[=+\-@]/.test(t) && !/^-\d+(,\d+)?$/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV met puntkomma's en decimale komma's, zoals Nederlandse Excel dat verwacht. */
export function naarCsv(artikelen, extraKosten = []) {
  const kop = ['Naam', 'Categorie', 'Merk', 'Maat', 'Status', 'Inkoopdatum', 'Gekocht bij', 'Inkoopprijs',
    'Verkoopdatum', 'Verkoopprijs', 'Kosten', 'Winst', 'Notitie'];
  const regels = artikelen.map((a) => [
    a.naam, a.categorie, a.merk, a.maat, STATUSSEN[a.status], a.inkoopdatum, a.inkoopbron, euroInvoer(a.inkoopprijs),
    a.verkoopdatum, euroInvoer(a.verkoopprijs), euroInvoer(a.kosten), euroInvoer(winst(a)), a.notitie,
  ].map(csvVeld).join(';'));
  // Met een negatieve winst klopt het totaal van de kolom Winst met de app.
  const kostenRegels = extraKosten.map((k) => [
    k.naam, '', '', '', 'Extra kosten', '', '', '', k.datum, '', euroInvoer(k.bedrag), euroInvoer(-k.bedrag), '',
  ].map(csvVeld).join(';'));
  return `﻿${[kop.join(';'), ...regels, ...kostenRegels].join('\r\n')}\r\n`;
}
