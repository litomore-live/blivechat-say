// Wire format follows blcsdk/blcsdk/models.py, not the frontend chat protocol.
export const Command = Object.freeze({HEARTBEAT: 0, INIT: 1, ADMIN: 5, TEXT: 50, GIFT: 51, MEMBER: 52, SUPER_CHAT: 53,
  FOLLOW: 'BLIVECHAT_SAY_FOLLOW', ENTER: 'BLIVECHAT_SAY_ENTER', LIKE: 'BLIVECHAT_SAY_LIKE'});

export function cleanText(text, maxLength) {
  // Prevent incoming macOS speech directives from changing voice/rate or pausing the queue.
  const clean = text.replaceAll('[[', '［［').replaceAll(']]', '］］')
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
  const characters = Array.from(clean);
  return characters.length > maxLength ? `${characters.slice(0, maxLength).join('')}…` : clean;
}

export function formatMessage(message, config) {
  if (!message || typeof message !== 'object' || message.extra?.isFromPlugin) return null;
  if (config.roomIds.length && !config.roomIds.includes(message.extra?.roomId)) return null;
  const data = message.data;
  let template;
  let values;
  if (message.cmd === Command.TEXT) {
    if (!Array.isArray(data) || typeof data[4] !== 'string' || data[13] !== 0 || data[6] || data[18]) return null;
    if (!data[4].trim()) return null;
    template = config.templates.text;
    values = {author: data[2], content: data[4]};
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    values = {author: data.authorName, content: data.content, price: data.price};
    if ([Command.FOLLOW, Command.ENTER, Command.LIKE].includes(message.cmd) && typeof data.authorName === 'string' && data.authorName.trim()) {
      const key = {[Command.FOLLOW]: 'follow', [Command.ENTER]: 'enter', [Command.LIKE]: 'like'}[message.cmd];
      template = config.templates[key];
    } else if (message.cmd === Command.SUPER_CHAT && typeof data.content === 'string' && data.content.trim()) {
      template = config.templates.superChat;
    } else if (message.cmd === Command.GIFT) {
      template = data.totalCoin > 0 ? config.templates.paidGift : config.templates.freeGift;
      Object.assign(values, {gift: data.giftName, num: data.num, price: (data.totalCoin ?? 0) / 1000});
    } else if (message.cmd === Command.MEMBER) {
      template = config.templates.member;
      Object.assign(values, {num: data.num, unit: data.unit, guard: {1: '总督', 2: '提督', 3: '舰长'}[data.privilegeType] ?? '舰队',
        price: (data.totalCoin ?? data.total_coin ?? 0) / 1000});
    }
  }
  if (!template) return null;
  const text = cleanText(template.replace(/\{([^{}]+)\}/gu, (_, key) => String(values[key] ?? '')), config.maxLength);
  return text || null;
}
