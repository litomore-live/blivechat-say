export class SpeechQueue {
  constructor({speak, cancel, maxQueueSize, maxAgeSeconds, onError = console.error, now = Date.now}) {
    Object.assign(this, {speak, cancel, maxQueueSize, maxAgeSeconds, onError, now});
    this.pending = [];
    this.lastSpokenText = null;
    this.speaking = false;
    this.stopped = false;
  }

  enqueue(text, author, {allowRepeat = false} = {}) {
    if (this.stopped || (!allowRepeat && text === this.pending.at(-1)?.text)) return;
    if (this.pending.length >= this.maxQueueSize) this.pending.shift();
    this.pending.push({text, author, allowRepeat, createdAt: this.now()});
    void this.drain();
  }

  async drain() {
    if (this.speaking || this.stopped) return;
    this.speaking = true;
    try {
      while (!this.stopped && this.pending.length) {
        const item = this.pending.shift();
        if (this.now() - item.createdAt > this.maxAgeSeconds * 1000) continue;
        if (!item.allowRepeat && item.text === this.lastSpokenText) continue;
        try {
          await this.speak(item.text, item.author);
          this.lastSpokenText = item.text;
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
