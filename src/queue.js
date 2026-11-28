function sameChatSpeaker(current, previous) {
  return Boolean(current.chat && previous?.chat && (current.chat.uid || current.author)
    && current.chat.uid === previous.chat.uid && current.author === previous.author && current.chat.roomId === previous.chat.roomId);
}

function isRepeat(current, previous) {
  if (current.text !== previous?.text) return false;
  if (!current.chat && !previous.chat) return true;
  return sameChatSpeaker(current, previous) && current.chat.body === previous.chat.body;
}

export class SpeechQueue {
  constructor({speak, cancel, maxQueueSize, maxAgeSeconds, onError = console.error, now = Date.now}) {
    Object.assign(this, {speak, cancel, maxQueueSize, maxAgeSeconds, onError, now});
    this.pending = [];
    this.lastSpoken = null;
    this.speaking = false;
    this.stopped = false;
  }

  enqueue(announcement, {allowRepeat = false} = {}) {
    if (this.stopped || (!allowRepeat && isRepeat(announcement, this.pending.at(-1)))) return;
    if (this.pending.length >= this.maxQueueSize) this.pending.shift();
    this.pending.push({...announcement, allowRepeat, createdAt: this.now()});
    void this.drain();
  }

  async drain() {
    if (this.speaking || this.stopped) return;
    this.speaking = true;
    try {
      while (!this.stopped && this.pending.length) {
        const item = this.pending.shift();
        if (this.now() - item.createdAt > this.maxAgeSeconds * 1000) continue;
        if (!item.allowRepeat && isRepeat(item, this.lastSpoken)) continue;
        try {
          const playback = sameChatSpeaker(item, this.lastSpoken)
            ? {...item, text: item.chat.body, language: item.chat.language, prefixPart: undefined}
            : item;
          await this.speak(playback);
          this.lastSpoken = item;
        } catch (error) {
          if (!this.stopped) this.onError(error);
        }
      }
    } finally {
      this.speaking = false;
    }
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.pending.length = 0;
    if (this.speaking) await this.cancel();
  }
}
