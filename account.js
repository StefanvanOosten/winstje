// Inloggen en synchroniseren met Supabase. De bibliotheek wordt pas geladen als
// de koppeling is ingesteld; zonder internet blijft de app gewoon lokaal werken.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { ruweArtikelen, schrijfRuw } from './db.js';
import { synchroniseer } from './sync.js';

const BIBLIOTHEEK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const CURSOR = 'winstje-sync-cursor';

const FOUTEN = {
  'Invalid login credentials': 'E-mailadres of wachtwoord klopt niet',
  'Email not confirmed': 'Bevestig eerst je e-mailadres via de mail die je hebt gekregen',
  'User already registered': 'Dit e-mailadres heeft al een account',
  'Signups not allowed for this instance': 'Nieuwe accounts zijn uitgeschakeld',
};

let clientBelofte;
let bezig = null;

export const isGekoppeld = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

function client() {
  clientBelofte ??= import(BIBLIOTHEEK)
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY))
    .catch((fout) => {
      clientBelofte = null;
      throw fout;
    });
  return clientBelofte;
}

function leesCursor() {
  try {
    return localStorage.getItem(CURSOR);
  } catch {
    return null;
  }
}

function zetCursor(waarde) {
  try {
    if (waarde) localStorage.setItem(CURSOR, waarde);
    else localStorage.removeItem(CURSOR);
  } catch {
    // Zonder cursor wordt de volgende keer alles opnieuw vergeleken.
  }
}

export function foutTekst(fout) {
  if (fout?.message && FOUTEN[fout.message]) return FOUTEN[fout.message];
  if (fout?.message?.includes('Password should be')) return 'Kies een wachtwoord van minstens 6 tekens';
  return 'Dat lukte niet. Controleer je internet en probeer het opnieuw.';
}

export async function huidigAccount() {
  if (!isGekoppeld()) return null;
  try {
    const { data } = await (await client()).auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

export async function inloggen(email, wachtwoord) {
  const { data, error } = await (await client()).auth.signInWithPassword({ email, password: wachtwoord });
  if (error) throw error;
  return data.user;
}

/** Geeft de gebruiker terug, of null als die eerst zijn e-mail moet bevestigen. */
export async function registreren(email, wachtwoord) {
  const { data, error } = await (await client()).auth.signUp({ email, password: wachtwoord });
  if (error) throw error;
  return data.session ? data.user : null;
}

export async function uitloggen() {
  await (await client()).auth.signOut({ scope: 'local' });
  zetCursor(null);
}

/** Synchroniseert; een lopende ronde wordt niet dubbel gestart. Geeft het aantal binnengekomen wijzigingen. */
export function syncNu() {
  bezig ??= (async () => {
    const c = await client();
    const { data } = await c.auth.getSession();
    if (!data.session) return 0;
    const uitkomst = await synchroniseer(c, { lees: ruweArtikelen, schrijf: schrijfRuw }, leesCursor());
    zetCursor(uitkomst.cursor);
    return uitkomst.gewijzigd;
  })().finally(() => {
    bezig = null;
  });
  return bezig;
}
