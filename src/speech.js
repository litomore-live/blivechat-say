import {speechOptions} from './config.js';
import {hasLocalizedAnnouncement} from './voice-selection.js';

export async function speakAnnouncement({text, author, language, contentLanguage, prefixPart, autoSelectVoice}, {config, catalog, say, isStopped = () => false}) {
  const options = speechOptions(config, {author, catalog, language, autoSelectVoice});
  if (contentLanguage && !hasLocalizedAnnouncement(contentLanguage)) {
    const matchedVoice = catalog.match(contentLanguage);
    if (matchedVoice) options.voice = matchedVoice;
  }
  if (prefixPart) {
    const prefixOptions = prefixPart.language
      ? speechOptions(config, {author, catalog, language: prefixPart.language})
      : speechOptions(config);
    if (prefixOptions.voice !== options.voice) {
      const rest = text.slice(prefixPart.text.length).trimStart();
      if (!rest || rest === '…') return say(text, prefixOptions);
      await say(prefixPart.text, prefixOptions);
      if (isStopped()) return;
      return say(rest, options);
    }
  }
  return say(text, options);
}
