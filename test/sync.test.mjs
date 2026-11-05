import test from 'node:test';
import assert from 'node:assert/strict';
import { synchroniseer } from '../sync.js';

// Nagebootste Supabase-tabel: geeft elke opslag een oplopende servertijd, net als de trigger.
function nepServer(rijen = []) {
  let klok = 1000;
  const tijd = () => `t${String((klok += 1)).padStart(6, '0')}`;
  const tabel = new Map(rijen.map((r) => [r.id, { ...r, server_tijd: tijd() }]));
  const server = {
    tabel,
    verzonden: [],
    faalBijUpsert: false,
    from: () => ({
      select() {
        let vanaf = null;
        let limiet = Infinity;
        const vraag = {
          order: () => vraag,
          limit: (n) => { limiet = n; return vraag; },
          gt: (_, waarde) => { vanaf = waarde; return vraag; },
          then: (ok) => ok({
            data: [...tabel.values()]
              .filter((r) => !vanaf || r.server_tijd > vanaf)
              .sort((a, b) => a.server_tijd.localeCompare(b.server_tijd))
              .slice(0, limiet),
            error: null,
          }),
        };
        return vraag;
      },
      upsert: async (lijst) => {
        if (server.faalBijUpsert) return { error: new Error('netwerk') };
        server.verzonden.push(...lijst);
        lijst.forEach((r) => tabel.set(r.id, { ...r, server_tijd: tijd() }));
        return { error: null };
      },
    }),
  };
  return server;
}

function nepToestel(artikelen = []) {
  const opslag = new Map(artikelen.map((a) => [a.id, a]));
  return {
    opslag,
    lees: async () => [...opslag.values()],
    schrijf: async (lijst) => lijst.forEach((a) => opslag.set(a.id, a)),
  };
}

const rij = (id, gewijzigd, naam = id, verwijderd = false) => ({ id, gewijzigd, verwijderd, data: { id, naam, status: 'voorraad' } });

test('bestaande artikelen zonder sync-gegevens gaan bij de eerste keer online', async () => {
  const server = nepServer();
  const toestel = nepToestel([{ id: 'a', naam: 'Jas', status: 'voorraad', gewijzigd: '2026-01-01T00:00:00Z' }]);
  await synchroniseer(server, toestel, null);
  assert.equal(server.tabel.get('a').data.naam, 'Jas');
  assert.equal(toestel.opslag.get('a').vuil, false);
});

test('sync-velden komen niet in de data terecht', async () => {
  const server = nepServer();
  const toestel = nepToestel([{ id: 'a', naam: 'Jas', gewijzigd: '2026-01-01T00:00:00Z', vuil: true }]);
  await synchroniseer(server, toestel, null);
  const data = server.tabel.get('a').data;
  assert.equal('vuil' in data, false);
  assert.equal('gewijzigd' in data, false);
});

test('een nieuwe telefoon krijgt alles terug', async () => {
  const server = nepServer([rij('a', '2026-01-01T00:00:00Z', 'Jas'), rij('b', '2026-01-02T00:00:00Z', 'Tas')]);
  const toestel = nepToestel();
  const { gewijzigd } = await synchroniseer(server, toestel, null);
  assert.equal(gewijzigd, 2);
  assert.equal(toestel.opslag.get('b').naam, 'Tas');
  assert.equal(server.verzonden.length, 0);
});

test('ophalen werkt ook over meerdere pagina\'s', async () => {
  const rijen = Array.from({ length: 250 }, (_, i) => rij(`a${i}`, '2026-01-01T00:00:00Z'));
  const toestel = nepToestel();
  await synchroniseer(nepServer(rijen), toestel, null);
  assert.equal(toestel.opslag.size, 250);
});

test('tweede ronde verstuurt en verandert niets', async () => {
  const server = nepServer();
  const toestel = nepToestel([{ id: 'a', naam: 'Jas', gewijzigd: '2026-01-01T00:00:00Z' }]);
  const eerste = await synchroniseer(server, toestel, null);
  const aantal = server.verzonden.length;
  const tweede = await synchroniseer(server, toestel, eerste.cursor);
  assert.equal(tweede.gewijzigd, 0);
  assert.equal(server.verzonden.length, aantal);
});

test('de nieuwste wijziging wint, in beide richtingen', async () => {
  const server = nepServer([rij('oud', '2026-01-01T00:00:00Z', 'server'), rij('nieuw', '2026-03-01T00:00:00Z', 'server')]);
  const toestel = nepToestel([
    { id: 'oud', naam: 'toestel', gewijzigd: '2026-02-01T00:00:00Z', vuil: true },
    { id: 'nieuw', naam: 'toestel', gewijzigd: '2026-02-01T00:00:00Z', vuil: true },
  ]);
  await synchroniseer(server, toestel, null);
  assert.equal(server.tabel.get('oud').data.naam, 'toestel');
  assert.equal(toestel.opslag.get('nieuw').naam, 'server');
  assert.equal(server.tabel.get('nieuw').data.naam, 'server');
});

test('verwijderen komt door, in beide richtingen', async () => {
  const server = nepServer([rij('a', '2026-01-01T00:00:00Z'), rij('b', '2026-03-01T00:00:00Z', 'b', true)]);
  const toestel = nepToestel([
    { id: 'a', verwijderd: true, gewijzigd: '2026-02-01T00:00:00Z', vuil: true },
    { id: 'b', naam: 'b', gewijzigd: '2026-01-01T00:00:00Z', vuil: false },
  ]);
  await synchroniseer(server, toestel, null);
  assert.equal(server.tabel.get('a').verwijderd, true);
  assert.equal(toestel.opslag.get('b').verwijderd, true);
});

test('een al verwijderd artikel komt niet op een nieuwe telefoon', async () => {
  const toestel = nepToestel();
  await synchroniseer(nepServer([rij('a', '2026-01-01T00:00:00Z', 'a', true)]), toestel, null);
  assert.equal(toestel.opslag.size, 0);
});

test('bij een netwerkfout blijft alles klaarstaan voor de volgende ronde', async () => {
  const server = nepServer();
  server.faalBijUpsert = true;
  const toestel = nepToestel([{ id: 'a', naam: 'Jas', gewijzigd: '2026-01-01T00:00:00Z', vuil: true }]);
  await assert.rejects(synchroniseer(server, toestel, null));
  assert.equal(toestel.opslag.get('a').vuil, true);
  server.faalBijUpsert = false;
  await synchroniseer(server, toestel, null);
  assert.equal(server.tabel.get('a').data.naam, 'Jas');
  assert.equal(toestel.opslag.get('a').vuil, false);
});

test('wijzigen tijdens het versturen gaat niet verloren', async () => {
  const server = nepServer();
  const toestel = nepToestel([{ id: 'a', naam: 'Jas', gewijzigd: '2026-01-01T00:00:00Z', vuil: true }]);
  const from = server.from;
  server.from = () => {
    const tabel = from();
    const upsert = tabel.upsert;
    tabel.upsert = async (lijst) => {
      const uit = await upsert(lijst);
      toestel.opslag.set('a', { id: 'a', naam: 'Jas 2', gewijzigd: '2026-01-02T00:00:00Z', vuil: true });
      return uit;
    };
    return tabel;
  };
  await synchroniseer(server, toestel, null);
  assert.equal(toestel.opslag.get('a').vuil, true);
  assert.equal(toestel.opslag.get('a').naam, 'Jas 2');
});
