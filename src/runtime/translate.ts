// Non-English brief support (issue #8, docs/DECISIONS.md #17 in the dev
// repo). A free zero-cost prompt-wording fix was tried and reverted for
// no measured benefit; the only real fix left was actual translation
// before parsing. Piloted directly against the exact failure case from
// #17 (a Polish pricing brief that returned no_match while its English
// equivalent was a confident 0.98 match): translating first turned that
// no_match into a real shortlist of genuine pricing components.
//
// Language detection is local and free (franc-min, a pure offline
// n-gram classifier, no network call, so an English brief costs nothing
// extra). Translation itself calls MyMemory's free, keyless API
// (api.mymemory.translated.net), rate-limited per calling IP (~1,000
// words/day anonymous) — since matchcn runs as a local MCP server on
// each user's own machine, that limit is already effectively per-user,
// not a shared pool this project could exhaust on everyone's behalf.
//
// Never throws and never blocks: any detection/network/parse failure
// falls back to the original, untranslated text, exactly like passing
// no fix through at all. A brief that can't be translated is no worse
// off than before this existed.

import { franc } from "franc-min";

const TRANSLATE_ENDPOINT = "https://api.mymemory.translated.net/get";
const TIMEOUT_MS = 5000;
const MIN_LENGTH_FOR_DETECTION = 10; // franc is unreliable on very short strings

// franc is a trigram-frequency model: on a short phrase it can score
// English below several unrelated languages just from incidental letter
// patterns (confirmed directly: "a calendar for picking a date" -- pure
// English -- scores Romanian above English, with English not even in
// franc's own top 5). A wrong "this is non-English" call is the costly
// mistake here (it sends real English through a translation round-trip
// that could subtly reword it), while a wrong "this is English" call
// costs nothing (falls through to the existing, already-accepted
// behavior). So English gets a cheap, robust veto ahead of franc: pure
// ASCII text containing at least one common English function word is
// treated as English outright, never handed to franc at all. Genuine
// non-English European text almost always fails the ASCII test on its
// own (diacritics), and even the rare diacritic-free case is unlikely to
// contain one of these specific short function words.
const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "or", "of", "in", "on", "at",
  "to", "is", "are", "that", "this", "it", "as", "by", "from", "into",
]);

function looksClearlyEnglish(text: string): boolean {
  if (!/^[\x00-\x7F]*$/.test(text)) return false; // any non-ASCII char rules this out
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.some((w) => ENGLISH_STOPWORDS.has(w));
}

// franc returns ISO 639-3; MyMemory's langpair wants ISO 639-1. Only the
// languages actually worth mapping here need an entry — anything else
// falls through to "no confident non-English detection" and is left
// untranslated rather than guessed at.
const ISO_639_3_TO_1: Record<string, string> = {
  eng: "en", pol: "pl", deu: "de", fra: "fr", spa: "es", ita: "it",
  por: "pt", nld: "nl", rus: "ru", ukr: "uk", ces: "cs", ron: "ro",
  swe: "sv", dan: "da", fin: "fi", nor: "no", tur: "tr", ell: "el",
  hun: "hu", jpn: "ja", kor: "ko", cmn: "zh", vie: "vi", tha: "th",
  ind: "id", arb: "ar", heb: "he",
};

export interface TranslationResult {
  text: string;
  translated: boolean;
  detectedLanguage?: string;
}

async function translateViaApi(text: string, sourceLang: string): Promise<string | null> {
  const url = `${TRANSLATE_ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${sourceLang}|en`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = (await res.json()) as { responseData?: { translatedText?: string }; quotaFinished?: boolean };
    if (json.quotaFinished) return null;
    const translated = json.responseData?.translatedText;
    return typeof translated === "string" && translated.length > 0 ? translated : null;
  } catch {
    return null;
  }
}

// Detects the brief's language locally (free, offline) and translates to
// English only if it confidently is NOT English. Falls back to the
// original text on any ambiguity or failure, never throws.
export async function translateBriefToEnglish(brief: string): Promise<TranslationResult> {
  if (brief.trim().length < MIN_LENGTH_FOR_DETECTION) {
    return { text: brief, translated: false };
  }

  if (looksClearlyEnglish(brief)) {
    return { text: brief, translated: false };
  }

  const detected = franc(brief, { minLength: MIN_LENGTH_FOR_DETECTION });
  if (detected === "und" || detected === "eng") {
    return { text: brief, translated: false };
  }

  const sourceLang = ISO_639_3_TO_1[detected];
  if (!sourceLang) {
    // Detected as non-English but not one of the mapped languages MyMemory
    // is known to handle well here; leave it untranslated rather than
    // guess at an unverified language code.
    return { text: brief, translated: false, detectedLanguage: detected };
  }

  const translated = await translateViaApi(brief, sourceLang);
  if (!translated) {
    return { text: brief, translated: false, detectedLanguage: detected };
  }
  // franc still misfires on some short, stopword-free English text (e.g.
  // "responsive navbar mobile menu" scored as French). Caught here rather
  // than tightened further upstream: a real non-English source translates
  // to something different from the input, so an unchanged round-trip
  // (case-insensitive) means the "detection" was wrong and this was
  // already English -- report it as such instead of a misleading
  // detectedLanguage on an otherwise no-op call.
  if (translated.trim().toLowerCase() === brief.trim().toLowerCase()) {
    return { text: brief, translated: false };
  }
  return { text: translated, translated: true, detectedLanguage: detected };
}
