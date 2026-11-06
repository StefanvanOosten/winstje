// Opslag op het toestel (IndexedDB). Artikelen zonder `vuil: false` moeten nog
// naar de online database. Verwijderde artikelen blijven als markering staan,
// zodat de verwijdering ook online doorkomt. Extra kosten (`soort: 'kosten'`) staan
// in dezelfde opslag, zodat ze zonder aparte tabel meesynchroniseren.

const DB_NAAM = 'winstje';
const STORE = 'artikelen';

let verbinding;

function openDb() {
  verbinding ??= new Promise((resolve, reject) => {
    const verzoek = indexedDB.open(DB_NAAM, 1);
    verzoek.onupgradeneeded = () => verzoek.result.createObjectStore(STORE, { keyPath: 'id' });
    verzoek.onsuccess = () => resolve(verzoek.result);
    verzoek.onerror = () => reject(verzoek.error);
  });
  return verbinding;
}

async function transactie(modus, werk) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, modus);
    const resultaat = werk(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(resultaat?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const nu = () => new Date().toISOString();

const markering = (id) => ({ id, verwijderd: true, gewijzigd: nu(), vuil: true });

/** Alles wat er op het toestel staat, inclusief verwijdermarkeringen. */
export const ruweArtikelen = () => transactie('readonly', (s) => s.getAll());

export const schrijfRuw = (artikelen) => transactie('readwrite', (s) => {
  artikelen.forEach((a) => s.put(a));
});

const actueel = async () => (await ruweArtikelen()).filter((a) => !a.verwijderd);

export const alleArtikelen = async () => (await actueel()).filter((a) => a.soort !== 'kosten');

export const alleKosten = async () => (await actueel()).filter((a) => a.soort === 'kosten');

export const bewaarArtikel = (artikel) => transactie('readwrite', (s) => s.put({
  ...artikel, gewijzigd: nu(), vuil: true,
}));

export const verwijderArtikel = (id) => transactie('readwrite', (s) => s.put(markering(id)));

export async function vervangAlles(artikelen) {
  const nieuw = new Set(artikelen.map((a) => a.id));
  const weg = (await ruweArtikelen()).filter((a) => !nieuw.has(a.id) && !a.verwijderd);
  await transactie('readwrite', (s) => {
    artikelen.forEach((a) => s.put({ ...a, verwijderd: false, gewijzigd: nu(), vuil: true }));
    weg.forEach((a) => s.put(markering(a.id)));
  });
}
