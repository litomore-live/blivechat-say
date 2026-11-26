import {speechOptions} from './config.js';

export async function speakAnnouncement({text, author, language, namePart, autoSelectVoice}, {config, catalog, say, isStopped = () => false}) {
  const options = speechOptions(config, {author, catalog, language, autoSelectVoice});
  if (namePart) {
    const nameOptions = speechOptions(config, {author, catalog, language: namePart.language});
    if (nameOptions.voice !== options.voice) {
      // The length limit applies to the whole announcement, including the name.
      const rest = text.slice(namePart.text.length).trimStart();
      if (!rest || rest === '…') return say(text, nameOptions);
      await say(namePart.text, nameOptions);
      if (isStopped()) return;
      return say(rest, options);
    }
  }
  return say(text, options);
}
