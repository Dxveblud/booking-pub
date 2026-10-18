/**
 * Recensioni Google della scheda del negozio (Places API "New").
 *
 * Attivo solo se in .env c'è GOOGLE_PLACES_API_KEY. La chiave va limitata
 * nella console Google all'IP del server e alla sola "Places API (New)".
 *
 * Ogni negozio indica la sua scheda (google.placeId, dal pannello). Valutazione
 * e recensioni si chiedono a Google al massimo una volta ogni 24 ore per
 * negozio e si tengono in cache: le chiamate restano nella quota gratuita e le
 * regole di Google (niente copie più vecchie di 30 giorni) sono rispettate.
 * Google restituisce al massimo 5 recensioni per scheda.
 */
const { Business } = require('../models');

const API = 'https://places.googleapis.com/v1';
const CACHE_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000; // dopo un errore riprova al massimo ogni ora
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

const apiKey = () => process.env.GOOGLE_PLACES_API_KEY || '';
const isEnabled = () => Boolean(apiKey());
const isValidPlaceId = (id) => PLACE_ID_RE.test(String(id || ''));

/** Link ufficiale di Google per scrivere una recensione su quella scheda. */
const writeReviewUrl = (placeId) => (isValidPlaceId(placeId) ? `https://search.google.com/local/writereview?placeid=${placeId}` : '');

async function call(path, { method = 'GET', fields, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': fields, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || `Google Places: errore ${res.status}`);
  return data;
}

/** Cerca le schede Google che corrispondono al testo (es. "IM Hair Studio Borgo Santa Maria"). */
async function searchPlaces(query) {
  const data = await call('/places:searchText', {
    method: 'POST',
    fields: 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount',
    body: { textQuery: String(query).slice(0, 200), languageCode: 'it', maxResultCount: 5 },
  });
  return (data.places || []).map((p) => ({
    placeId: p.id,
    name: p.displayName && p.displayName.text,
    address: p.formattedAddress || '',
    rating: p.rating || 0,
    count: p.userRatingCount || 0,
  }));
}

async function fetchPlace(placeId) {
  const p = await call(`/places/${encodeURIComponent(placeId)}?languageCode=it`, {
    fields: 'id,rating,userRatingCount,googleMapsUri,reviews',
  });
  return {
    rating: p.rating || 0,
    count: p.userRatingCount || 0,
    url: p.googleMapsUri || '',
    reviews: (p.reviews || []).map((r) => ({
      author: (r.authorAttribution && r.authorAttribution.displayName) || 'Cliente Google',
      authorUrl: (r.authorAttribution && r.authorAttribution.uri) || '',
      photo: (r.authorAttribution && r.authorAttribution.photoUri) || '',
      rating: r.rating || 0,
      text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '',
      when: r.relativePublishTimeDescription || '',
      publishedAt: r.publishTime ? new Date(r.publishTime) : undefined,
    })).filter((r) => r.text),
    fetchedAt: new Date(),
  };
}

/**
 * Recensioni da mostrare sul sito. Normalmente quelle scelte dal titolare
 * (inserite a mano nel pannello). Solo se sul server c'è GOOGLE_PLACES_API_KEY
 * e la scheda è collegata, quelle di Google (cache aggiornata ogni 24 ore).
 */
async function getReviews(business) {
  const manual = business.reviews || {};
  const placeId = business.google && business.google.placeId;
  const fallback = {
    source: 'manual',
    rating: manual.rating || 0,
    count: manual.count || 0,
    url: manual.url || '',
    writeUrl: manual.writeUrl || writeReviewUrl(placeId),
    reviews: (manual.items || []).map((it) => ({ author: it.author, rating: it.rating, text: it.text, when: it.when })),
  };
  if (!placeId || !isEnabled()) return fallback;

  let cache = business.google.cache && business.google.cache.fetchedAt ? business.google.cache : null;
  const age = cache ? Date.now() - new Date(cache.fetchedAt).getTime() : Infinity;
  const lastError = business.google.errorAt ? Date.now() - new Date(business.google.errorAt).getTime() : Infinity;
  if (age > CACHE_MS && lastError > RETRY_MS) {
    try {
      cache = await fetchPlace(placeId);
      await Business.updateOne({ _id: business._id }, { $set: { 'google.cache': cache }, $unset: { 'google.errorAt': 1 } });
      business.google.cache = cache;
    } catch (err) {
      console.error(`[google] Recensioni di "${business.slug}" non aggiornate:`, err.message);
      await Business.updateOne({ _id: business._id }, { $set: { 'google.errorAt': new Date() } });
    }
  }
  if (!cache) return fallback;
  return {
    source: 'google',
    rating: cache.rating,
    count: cache.count,
    url: cache.url || manual.url || '',
    writeUrl: writeReviewUrl(placeId),
    reviews: (cache.reviews || []).map((r) => ({
      author: r.author, authorUrl: r.authorUrl, photo: r.photo, rating: r.rating, text: r.text, when: r.when,
    })),
  };
}

module.exports = { isEnabled, isValidPlaceId, searchPlaces, getReviews, writeReviewUrl };
