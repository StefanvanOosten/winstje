import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEuro, euroInvoer, winst, vandaagIso, dagenTussen, beschikbareJaren, jaarOverzicht, totaalOverzicht, blijvenLiggen, naarCsv,
} from '../logic.js';

test('parseEuro leest Nederlandse en gewone notaties', () => {
  assert.equal(parseEuro('12,50'), 1250);
  assert.equal(parseEuro('12.5'), 1250);
  assert.equal(parseEuro('12'), 1200);
  assert.equal(parseEuro('€ 1.250,00'), 125000);
  assert.equal(parseEuro('0,07'), 7);
  assert.equal(parseEuro('19,99'), 1999);
});

test('parseEuro: leeg is null, onzin is NaN', () => {
  assert.equal(parseEuro(''), null);
  assert.equal(parseEuro('   '), null);
  assert.equal(parseEuro(undefined), null);
  assert.ok(Number.isNaN(parseEuro('abc')));
  assert.ok(Number.isNaN(parseEuro('-5')));
  assert.ok(Number.isNaN(parseEuro('1,234')));
});

test('euroInvoer is het omgekeerde van parseEuro', () => {
  assert.equal(euroInvoer(1250), '12,50');
  assert.equal(euroInvoer(0), '0,00');
  assert.equal(euroInvoer(null), '');
  assert.equal(parseEuro(euroInvoer(1999)), 1999);
});

test('winst telt alleen voor verkochte artikelen en trekt kosten af', () => {
  assert.equal(winst({ status: 'verkocht', inkoopprijs: 500, verkoopprijs: 1500, kosten: 200 }), 800);
  assert.equal(winst({ status: 'verkocht', inkoopprijs: 1000, verkoopprijs: 500 }), -500);
  assert.equal(winst({ status: 'te_koop', inkoopprijs: 500 }), null);
});

test('vandaagIso gebruikt lokale tijd', () => {
  assert.equal(vandaagIso(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.equal(vandaagIso(new Date(2026, 11, 31, 23, 55)), '2026-12-31');
});

test('dagenTussen gaat goed over de zomertijdovergang heen', () => {
  assert.equal(dagenTussen('2026-03-28', '2026-03-30'), 2);
  assert.equal(dagenTussen('2026-01-01', '2026-03-02'), 60);
});

const data = [
  { id: 1, status: 'verkocht', inkoopdatum: '2025-12-20', inkoopprijs: 1000, verkoopdatum: '2026-01-10', verkoopprijs: 2500, kosten: 100 },
  { id: 2, status: 'verkocht', inkoopdatum: '2026-02-01', inkoopprijs: 500, verkoopdatum: '2026-03-05', verkoopprijs: 400 },
  { id: 3, status: 'verkocht', inkoopdatum: '2024-05-01', inkoopprijs: 300, verkoopdatum: '2025-06-01', verkoopprijs: 900 },
  { id: 4, status: 'te_koop', inkoopdatum: '2026-01-15', inkoopprijs: 700 },
  { id: 5, status: 'voorraad', inkoopdatum: '2026-10-20', inkoopprijs: 200 },
];

test('jaarOverzicht rekent verkoop toe aan het jaar van verkoop', () => {
  const o = jaarOverzicht(data, 2026);
  assert.equal(o.verkocht, 2);
  assert.equal(o.omzet, 2900);
  assert.equal(o.kosten, 100);
  assert.equal(o.winst, 1300);
  assert.equal(o.ingekocht, 1400);
  assert.equal(o.maanden[0].winst, 1400);
  assert.equal(o.maanden[2].winst, -100);
  assert.equal(o.maanden[1].aantal, 0);
});

test('jaarOverzicht: voorraad is de stand van nu, ongeacht het jaar', () => {
  for (const jaar of [2025, 2026]) {
    const o = jaarOverzicht(data, jaar);
    assert.equal(o.voorraadWaarde, 900);
    assert.equal(o.voorraadAantal, 2);
  }
  assert.equal(jaarOverzicht(data, 2025).winst, 600);
});

test('jaarOverzicht haalt extra kosten van de winst af in de juiste maand', () => {
  const zonder = jaarOverzicht(data, 2026);
  const kosten = [
    { soort: 'kosten', naam: 'Boosten', bedrag: 250, datum: '2026-03-10' },
    { soort: 'kosten', naam: 'Dozen', bedrag: 100, datum: '2026-03-20' },
    { soort: 'kosten', naam: 'Vorig jaar', bedrag: 999, datum: '2025-03-20' },
  ];
  const o = jaarOverzicht(data, 2026, kosten);
  assert.equal(o.extraKosten, 350);
  assert.equal(o.winst, zonder.winst - 350);
  assert.equal(o.maanden[2].winst, zonder.maanden[2].winst - 350);
  assert.equal(o.maanden[2].extraKosten, 350);
  assert.equal(o.omzet, zonder.omzet);
  assert.equal(o.verkocht, zonder.verkocht);
});

test('beschikbareJaren telt ook jaren met alleen extra kosten', () => {
  assert.deepEqual(beschikbareJaren([], 2026, [{ datum: '2023-05-01', bedrag: 100 }]), [2026, 2023]);
});

test('naarCsv zet extra kosten erbij met negatieve winst', () => {
  const csv = naarCsv([], [{ naam: '=Dozen', bedrag: 350, datum: '2026-03-10' }]);
  const regel = csv.split('\r\n')[1].split(';');
  assert.equal(regel[0], "'=Dozen");
  assert.equal(regel[4], 'Extra kosten');
  assert.equal(regel[8], '2026-03-10');
  assert.equal(regel[10], '3,50');
  assert.equal(regel[11], '-3,50');
});

test('totaalOverzicht telt alle jaren samen', () => {
  assert.deepEqual(totaalOverzicht(data), {
    ingekocht: 2700, opbrengst: 3800, verkocht: 3, voorraadWaarde: 900, voorraadAantal: 2,
  });
  assert.equal(totaalOverzicht([]).ingekocht, 0);
});

test('beschikbareJaren bevat alle jaren en altijd het huidige', () => {
  assert.deepEqual(beschikbareJaren(data, 2026), [2026, 2025, 2024]);
  assert.deepEqual(beschikbareJaren([], 2026), [2026]);
});

test('blijvenLiggen slaat verkochte en nieuwe artikelen over', () => {
  const lijst = blijvenLiggen(data, '2026-11-05');
  assert.deepEqual(lijst.map((a) => a.id), [4]);
});

test('blijvenLiggen slaat artikelen over die nog onderweg zijn', () => {
  const onderweg = { id: 6, status: 'gekocht', inkoopdatum: '2026-01-01', inkoopprijs: 100 };
  assert.deepEqual(blijvenLiggen([onderweg], '2026-11-05'), []);
});

test('naarCsv is geschikt voor Nederlandse Excel', () => {
  const csv = naarCsv([{ naam: 'Jas; "blauw"', status: 'verkocht', inkoopprijs: 500, verkoopprijs: 1250, kosten: 0, notitie: '=SOM(A1)' }]);
  assert.ok(csv.startsWith('﻿Naam;'));
  assert.ok(csv.includes('"Jas; ""blauw"""'));
  assert.ok(csv.includes(';5,00;'));
  assert.ok(csv.includes(';12,50;0,00;7,50;'));
  assert.ok(csv.includes("'=SOM(A1)"));
});
