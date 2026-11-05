// Opslag op het toestel (IndexedDB). Alles wat de app met opslag doet loopt via
// deze vier functies, zodat dit bestand later door een online database te
// vervangen is zonder dat de rest van de app verandert.

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

export const alleArtikelen = () => transactie('readonly', (s) => s.getAll());

export const bewaarArtikel = (artikel) => transactie('readwrite', (s) => s.put(artikel));

export const verwijderArtikel = (id) => transactie('readwrite', (s) => s.delete(id));

export const vervangAlles = (artikelen) => transactie('readwrite', (s) => {
  s.clear();
  artikelen.forEach((a) => s.put(a));
});
