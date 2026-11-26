// The package root imports Raycast AI. The three offline entry points run in plain Node.
import {detect as franc} from 'raycast-language-detector/franc';
import {detect as languageDetect} from 'raycast-language-detector/languagedetect';
import {detect as tinyLD} from 'raycast-language-detector/tinyld';

const offlineDetectors = [franc, languageDetect, tinyLD];
const supportedLanguages = new Set(['zh', 'en', 'ja', 'ko']);
export const hasLocalizedAnnouncement = language => supportedLanguages.has(language);

export function detectLanguage(text, {isName = false} = {}) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return undefined;
  // In mixed-script names and messages, classify the non-Latin letters first.
  const nonLatin = letters.replace(/\p{Script=Latin}/gu, '');
  if (nonLatin.length < letters.length) {
    if (!nonLatin && isName) return 'en';
    if (/^\p{Script=Han}+$/u.test(nonLatin)) return 'zh';
    if (/^[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]+$/u.test(nonLatin)) return 'ja';
    if (/^[\p{Script=Han}\p{Script=Hangul}]+$/u.test(nonLatin)) return 'ko';
  }
  let otherLanguage;
  for (const detect of offlineDetectors) {
    try {
      const result = detect(text);
      if (supportedLanguages.has(result?.languageCode)) return result.languageCode;
      if (result?.languageCode && result.languageCode !== 'und') otherLanguage ??= result.languageCode;
    } catch {
      // Keep speech available if a detector cannot process this message.
    }
  }
  // Short names, greetings and repeated characters can yield no supported result.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(letters)) return 'ja';
  if (/\p{Script=Hangul}/u.test(letters)) return 'ko';
  if (/\p{Script=Han}/u.test(letters)) return 'zh';
  if (/^(?:hi|hey|hello|ok|okay|yes|no|bye|lol|gg|wow|test)$/iu.test(letters)) return 'en';
  return otherLanguage;
}

export function announcementLanguage(nameLanguage, contentLanguage) {
  if (nameLanguage && !supportedLanguages.has(nameLanguage)) return nameLanguage;
  // A Chinese, Japanese or Korean voice can read the English part of a mixed announcement.
  if (contentLanguage === 'en') return nameLanguage ?? 'en';
  return contentLanguage ?? nameLanguage;
}

const normalize = code => code?.replaceAll('_', '-').toLowerCase();

function standardLocale(code) {
  if (!code) return undefined;
  // The macOS catalogs use both yue-HK and zh_HK for Cantonese.
  if (/^(?:yue|zh-(?:hant-|hans-)?(?:hk|mo))(?:-|$)/u.test(code)) return 'zh';
  return code.match(/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?=$|[-@])/u)?.[0];
}

const qualityRank = {premium: 2, enhanced: 1, standard: 0};
const siriNumber = voice => voice.isSiri ? Number(voice.name.match(/\d+/u)?.[0] ?? 0) : 0;

export function createVoiceCatalog(voices) {
  const available = voices.filter(voice => voice.enabled !== false);
  const languages = new Map();
  const byLocale = new Map();
  const byLanguage = new Map();
  const localeOf = voice => normalize(voice.languageCode ?? voice.culture ?? voice.language);

  // Match the speech backend's identifier, name, alias precedence and first matching row.
  for (const keys of [v => [v.identifier], v => [v.name], v => v.aliases ?? []]) {
    for (const voice of available) {
      const language = standardLocale(localeOf(voice))?.split('-')[0];
      for (const key of keys(voice)) {
        if (key && !languages.has(key)) languages.set(key, language);
      }
    }
  }

  available.sort((a, b) => (qualityRank[b.quality] ?? 0) - (qualityRank[a.quality] ?? 0)
    || Number(!!b.isSiri) - Number(!!a.isSiri) || siriNumber(b) - siriNumber(a));
  for (const voice of available) {
    const locale = localeOf(voice);
    // As in Raycast Say, dialect variants remain selectable explicitly.
    const code = standardLocale(locale);
    if (!code) continue;
    const language = code.split('-')[0];
    if (supportedLanguages.has(language) && locale !== code) continue;
    const key = voice.identifier ?? voice.name;
    if (!byLocale.has(code)) byLocale.set(code, key);
    if (!byLanguage.has(language)) byLanguage.set(language, key);
  }

  function match(detectedCode) {
    const code = standardLocale(normalize(detectedCode));
    return byLocale.get(code) ?? byLanguage.get(code?.split('-')[0]);
  }

  return {
    has: key => languages.has(key),
    match,
    select(preferred, detectedCode, defaultVoice = preferred) {
      const code = standardLocale(normalize(detectedCode));
      const language = code?.split('-')[0];
      if (language && !supportedLanguages.has(language)) return defaultVoice;
      const preferredLanguage = languages.get(preferred);
      if (!language || (preferred && !preferredLanguage) || preferredLanguage === language) return preferred;
      return match(detectedCode) ?? preferred;
    },
  };
}
