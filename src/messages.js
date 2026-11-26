import {announcementLanguage, detectLanguage} from './voice-selection.js';

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

const announcements = {
  zh: {
    text: '{author}说，{content}', superChat: '{author}发送了{price}元的醒目留言，{content}',
    enter: '{author}进入了直播间', follow: '{author}关注了直播间', like: '{author}点赞了直播间',
    gift: '{author}赠送了{num}个{gift}', member: '{author}开通了{guard}',
    ranks: ['大航海', '总督', '提督', '舰长'],
  },
  en: {
    text: '{author} says, {content}', superChat: '{author} sent a {price} yuan Super Chat. {content}',
    follow: '{author} followed the channel', like: '{author} liked the stream',
    gift: '{author} sent {gift} times {num}', member: '{author} joined as {guard}',
    ranks: ['a fleet member', 'a governor', 'an admiral', 'a captain'],
  },
  ja: {
    text: '{author}さんが言いました。{content}', superChat: '{author}さんから{price}人民元のスーパーチャットです。{content}',
    enter: '{author}さんが入室しました', follow: '{author}さんがフォローしました', like: '{author}さんがいいねしました',
    gift: '{author}さんが{gift}を{num}個贈りました', member: '{author}さんが{guard}になりました',
    ranks: ['艦隊メンバー', '総督', '提督', '艦長'],
  },
  ko: {
    text: '{author} 님의 메시지. {content}', superChat: '{author} 님이 {price}위안의 슈퍼챗을 보냈습니다. {content}',
    enter: '{author} 님이 입장했습니다', follow: '{author} 님이 채널을 팔로우했습니다', like: '{author} 님이 좋아요를 눌렀습니다',
    gift: '{author} 님이 {gift} 선물 {num}개를 보냈습니다', member: '{author} 님이 {guard} 등급에 가입했습니다',
    ranks: ['함대원', '총독', '제독', '함장'],
  },
};

const socialEvents = new Map([[Command.FOLLOW, 'follow'], [Command.ENTER, 'enter'], [Command.LIKE, 'like']]);

export function formatMessage(message, config) {
  if (!message || typeof message !== 'object' || message.extra?.isFromPlugin) return null;
  if (config.roomIds.length && !config.roomIds.includes(message.extra?.roomId)) return null;
  const data = message.data;
  let event;
  let author;
  let content;
  if (message.cmd === Command.TEXT) {
    if (!Array.isArray(data) || typeof data[4] !== 'string' || !data[4].trim() || data[13] !== 0 || data[6] || data[18]) return null;
    event = 'text';
    author = data[2];
    content = data[4];
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    author = data.authorName;
    if (socialEvents.has(message.cmd)) {
      if (typeof author !== 'string' || !author.trim()) return null;
      if (message.cmd === Command.ENTER && config.ignoredEnterUsers.includes(author)) return null;
      event = socialEvents.get(message.cmd);
    } else if (message.cmd === Command.SUPER_CHAT && typeof data.content === 'string' && data.content.trim()) {
      event = 'superChat';
      content = data.content;
    } else if (message.cmd === Command.GIFT) {
      event = data.totalCoin > 0 ? 'paidGift' : 'freeGift';
    } else if (message.cmd === Command.MEMBER) {
      event = 'member';
    }
  }
  if (!event || !config.events[event]) return null;

  const nameText = cleanText(String(author ?? ''), config.maxLength);
  const nameLanguage = detectLanguage(nameText, {isName: true});
  const contentLanguage = content ? detectLanguage(cleanText(content, config.maxLength)) : undefined;
  const englishEntry = event === 'enter' && nameLanguage === 'en';
  const language = englishEntry ? 'zh' : announcementLanguage(nameLanguage, contentLanguage);
  const phrases = announcements[language] ?? announcements.zh;
  const template = message.cmd === Command.GIFT ? phrases.gift : phrases[event];
  const values = {author, content, price: data.price, num: data.num ?? 1, gift: data.giftName,
    guard: phrases.ranks[data.privilegeType] ?? phrases.ranks[0]};
  const text = cleanText(template.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? '')), config.maxLength);
  const announcement = {text, author, language};
  if (englishEntry) announcement.autoSelectVoice = true;
  // All built-in phrases start with the author. The connector belongs to the body.
  if (nameLanguage && contentLanguage && nameLanguage !== contentLanguage &&
    nameLanguage !== 'en' && contentLanguage !== 'en' && announcements[nameLanguage] && announcements[contentLanguage]) {
    announcement.namePart = {text: nameText, language: nameLanguage};
  }
  return announcement;
}
