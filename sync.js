// Houdt de opslag op het toestel en de online database gelijk.
// Het toestel blijft leidend, zodat de app ook zonder internet werkt.
// Is iets op twee plekken gewijzigd, dan wint de nieuwste wijziging.

const PAGINA = 100;
const PUSH_BLOK = 20;

const isVuil = (a) => a.vuil !== false;

function naarRij(artikel) {
  const { vuil, verwijderd, gewijzigd, ...data } = artikel;
  return { id: artikel.id, data, gewijzigd, verwijderd: !!verwijderd };
}

function vanRij(rij) {
  return { ...rij.data, id: rij.id, gewijzigd: rij.gewijzigd, verwijderd: rij.verwijderd, vuil: false };
}

async function haalWijzigingen(client, cursor) {
  const rijen = [];
  let vanaf = cursor;
  for (;;) {
    let vraag = client.from('artikelen')
      .select('id,data,gewijzigd,verwijderd,server_tijd')
      .order('server_tijd', { ascending: true })
      .limit(PAGINA);
    if (vanaf) vraag = vraag.gt('server_tijd', vanaf);
    const { data, error } = await vraag;
    if (error) throw error;
    rijen.push(...data);
    if (data.length) vanaf = data.at(-1).server_tijd;
    if (data.length < PAGINA) return { rijen, cursor: vanaf };
  }
}

/**
 * Haalt eerst nieuwe wijzigingen op en stuurt daarna eigen wijzigingen door.
 * `lokaal` biedt lees() en schrijf(artikelen).
 * Geeft de nieuwe cursor en het aantal wijzigingen op het toestel terug.
 */
export async function synchroniseer(client, lokaal, cursor) {
  const { rijen, cursor: nieuweCursor } = await haalWijzigingen(client, cursor);

  const bekend = new Map((await lokaal.lees()).map((a) => [a.id, a]));
  const binnen = rijen.filter((rij) => {
    const hier = bekend.get(rij.id);
    if (!hier) return !rij.verwijderd;
    if (hier.gewijzigd === rij.gewijzigd) return false;
    if (isVuil(hier) && Date.parse(hier.gewijzigd) >= Date.parse(rij.gewijzigd)) return false;
    return true;
  }).map(vanRij);
  if (binnen.length) await lokaal.schrijf(binnen);

  const teVersturen = (await lokaal.lees()).filter(isVuil);
  for (let i = 0; i < teVersturen.length; i += PUSH_BLOK) {
    const blok = teVersturen.slice(i, i + PUSH_BLOK);
    const { error } = await client.from('artikelen').upsert(blok.map(naarRij));
    if (error) throw error;

    // Wat tijdens het versturen opnieuw is gewijzigd, blijft staan voor de volgende ronde.
    const nu = new Map((await lokaal.lees()).map((a) => [a.id, a]));
    const klaar = blok
      .filter((a) => nu.get(a.id)?.gewijzigd === a.gewijzigd)
      .map((a) => ({ ...nu.get(a.id), vuil: false }));
    if (klaar.length) await lokaal.schrijf(klaar);
  }

  return { cursor: nieuweCursor, gewijzigd: binnen.length };
}
