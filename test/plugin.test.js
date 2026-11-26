import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {Duplex, PassThrough} from 'node:stream';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import WebSocket, {WebSocketServer} from 'ws';
import {validateConfig, speechOptions} from '../src/config.js';
import {Command, cleanText, formatMessage} from '../src/messages.js';
import {SpeechQueue} from '../src/queue.js';
import {connectPlugin} from '../src/client.js';
import {speakAnnouncement} from '../src/speech.js';
import {createVoiceCatalog} from '../src/voice-selection.js';

const formattedText = (message, config) => formatMessage(message, config)?.text ?? null;

function danmaku(content = '你好', extra = {}) {
  return {cmd: Command.TEXT, data: ['', 1, '小明', 0, content, 0, false, 1, false, true, 0, 'id', '', 0, {}, 0, 'uid', '', false], extra};
}

test('combines separately detected name and body languages for each announcement', () => {
  const config = validateConfig({});
  for (const [author, content, language, text] of [
    ['小明', 'Hello', 'zh', '小明说，Hello'],
    ['一果Old', 'Hello', 'zh', '一果Old说，Hello'],
    ['Alice', '🌟 Old_一果42', 'zh', 'Alice说，🌟 Old_一果42'],
    ['Alice', 'Hello', 'en', 'Alice says, Hello'],
    ['さくら', 'Hello', 'ja', 'さくらさんが言いました。Hello'],
    ['민수', 'Hello', 'ko', '민수 님의 메시지. Hello'],
    ['Alice', '안녕하세요', 'ko', 'Alice 님의 메시지. 안녕하세요'],
    ['Alice', '你好', 'zh', 'Alice说，你好'],
    ['Alice', 'こんにちは', 'ja', 'Aliceさんが言いました。こんにちは'],
    ['Alice_42', '🎉', 'en', 'Alice_42 says, 🎉'],
    ['Alice', 'Привет всем', 'ru', 'Alice说，Привет всем'],
    ['Привет', '你好', 'ru', 'Привет说，你好'],
  ]) {
    const message = danmaku(content);
    message.data[2] = author;
    assert.deepEqual(formatMessage(message, config), {text, language, author});
  }
  for (const [author, language, text] of [
    ['一果Old', 'zh', '一果Old进入了直播间'],
    ['山田さんOld', 'ja', '山田さんOldさんが入室しました'],
    ['민수漢字Old', 'ko', '민수漢字Old 님이 입장했습니다'],
    ['さくら', 'ja', 'さくらさんが入室しました'],
    ['민수', 'ko', '민수 님이 입장했습니다'],
  ]) {
    assert.deepEqual(formatMessage({cmd: Command.ENTER, data: {authorName: author}}, config), {text, language, author});
  }
});

test('announces English usernames entering in Chinese, including when no voice is configured', async () => {
  const catalog = createVoiceCatalog([
    {name: 'Meijia', languageCode: 'zh_TW'}, {name: 'English', culture: 'en-US'},
  ]);
  const authorName = 'Alice_42';
  const enter = {cmd: Command.ENTER, data: {authorName}};
  const follow = {cmd: Command.FOLLOW, data: {authorName}};
  for (const [event, preferred, expectedText, expectedVoice] of [
    [enter, 'English', 'Alice_42进入了直播间', 'Meijia'],
    [enter, '', 'Alice_42进入了直播间', 'Meijia'],
    [follow, 'English', 'Alice_42 followed the channel', 'English'],
    [follow, '', 'Alice_42 followed the channel', undefined],
  ]) {
    const config = validateConfig({default: {voice: preferred}});
    const calls = [];
    await speakAnnouncement(formatMessage(event, config), {config, catalog, say: (text, {voice}) => calls.push([text, voice])});
    assert.deepEqual(calls, [[expectedText, expectedVoice]]);
  }
});

test('a mixed English announcement uses one compatible voice and unsupported languages use the global default', async () => {
  const catalog = createVoiceCatalog([
    {name: 'Meijia', languageCode: 'zh_TW'}, {name: 'Sinji', languageCode: 'yue_HK'},
    {name: 'English', culture: 'en-US'}, {name: '日本語', languageCode: 'ja_JP'}, {name: '한국어', culture: 'ko-KR'},
  ]);
  const users = {Alice: {voice: 'Sinji'}, 'Привет': {voice: '日本語'}};
  const config = validateConfig({default: {voice: 'Meijia'}, users});
  for (const [author, body, expected] of [
    ['Alice', '欢迎回来', 'Sinji'], ['Alice', 'Hello', 'English'], ['小明', 'Hello', 'Meijia'],
    ['さくら', 'Hello', '日本語'], ['민수', 'Hello', '한국어'],
    ['Alice', 'Bonjour tout le monde', 'Meijia'], ['Привет', 'Hello', 'Meijia'],
  ]) {
    const message = danmaku(body);
    message.data[2] = author;
    const announcement = formatMessage(message, config);
    const calls = [];
    await speakAnnouncement(announcement, {config, catalog, say: (text, {voice}) => calls.push([text, voice])});
    assert.deepEqual(calls, [[announcement.text, expected]]);
  }
  const systemDefault = validateConfig({default: {voice: '', rate: 180}, users}, 'darwin');
  assert.deepEqual(speechOptions(systemDefault, {platform: 'darwin', author: 'Alice', catalog, language: 'fr'}),
    {skipRunningCheck: true, rate: 180});
});

test('a Chinese name and Japanese message split before the connector and honor truncation and cancellation', async () => {
  const catalog = createVoiceCatalog([{name: 'Meijia', languageCode: 'zh_TW'}, {name: 'Kyoko', languageCode: 'ja_JP'}]);
  for (const [maxLength, stopAfterName, expected] of [
    [120, false, [['小明', 'Meijia'], ['さんが言いました。こんにちは', 'Kyoko']]],
    [120, true, [['小明', 'Meijia']]],
    [1, false, [['小…', 'Meijia']]],
  ]) {
    const config = validateConfig({default: {voice: 'Meijia'}, maxLength});
    const message = formatMessage(danmaku('こんにちは'), config);
    const calls = [];
    await speakAnnouncement(message, {config, catalog, isStopped: () => stopAfterName,
      say: (text, {voice}) => calls.push([text, voice])});
    assert.deepEqual(calls, expected);
  }
});

test('decodes actual SDK array positions and excludes synthetic, mirrored, gift and emoticon messages', () => {
  const config = validateConfig({});
  assert.equal(formattedText(danmaku(), config), '小明说，你好');
  assert.equal(formattedText(danmaku('你好', {isFromPlugin: true}), config), null);
  for (const [index, value] of [[6, true], [13, 1], [18, true]]) {
    const message = danmaku();
    message.data[index] = value;
    assert.equal(formattedText(message, config), null);
  }
  const oldMessage = danmaku();
  oldMessage.data.pop(); // Before SDK added isMirror.
  assert.equal(formattedText(oldMessage, config), '小明说，你好');
  assert.equal(formattedText(danmaku('   '), config), null);
  const filtered = validateConfig({roomIds: [123]});
  assert.equal(formattedText(danmaku('你好', {roomId: 456}), filtered), null);
  assert.equal(formattedText(danmaku('你好', {roomId: 123}), filtered), '小明说，你好');
});

test('formats SC, paid/free gifts and guard ranks with event switches', () => {
  const config = validateConfig({events: {paidGift: true, member: true}});
  assert.equal(formattedText({cmd: Command.SUPER_CHAT, data: {authorName: '小明', content: '加油', price: 30}}, config), '小明发送了30元的醒目留言，加油');
  const gift = {cmd: Command.GIFT, data: {authorName: '小明', num: 2, giftName: '礼物', totalCoin: 2000}};
  assert.equal(formattedText(gift, config), '小明赠送了2个礼物');
  gift.data.totalCoin = 0;
  assert.equal(formattedText(gift, config), null);
  for (const [privilegeType, name] of [[1, '总督'], [2, '提督'], [3, '舰长']]) {
    assert.equal(formattedText({cmd: Command.MEMBER, data: {authorName: '小明', privilegeType}}, config), `小明开通了${name}`);
  }
});

test('normalizes speech and validates platform-specific options and event switches', () => {
  assert.equal(cleanText(' A\n\u0000 B [[rate 900]]', 100), 'A B ［［rate 900］］');
  assert.equal(cleanText('😀你好', 2), '😀你…');
  assert.throws(() => validateConfig({maxQueueSize: 0}));
  assert.throws(() => validateConfig({events: {text: 'true'}}));
  assert.throws(() => validateConfig({events: []}));
  assert.throws(() => validateConfig({default: {rate: 200}}, 'win32'));
  assert.throws(() => validateConfig({default: {volume: 50}}, 'darwin'));
  assert.throws(() => validateConfig({default: {audioDevice: '1'}}, 'win32'));
  const config = validateConfig({default: {rate: 0, volume: 50}}, 'win32');
  assert.deepEqual(speechOptions(config, {platform: 'win32'}), {skipRunningCheck: true, rate: 0, volume: 50});
});

for (const [cmd, template, text] of [[Command.FOLLOW, 'follow', '小明关注了直播间'], [Command.ENTER, 'enter', '小明进入了直播间'],
  [Command.LIKE, 'like', '小明点赞了直播间']]) {
  test(`announces ${template} events and honors event, room and plugin filters`, () => {
    const event = {cmd, data: {authorName: '小明'}, extra: {roomId: 123}};
    assert.equal(formattedText(event, validateConfig({})), text);
    assert.equal(formattedText(event, validateConfig({events: {[template]: false}})), null);
    assert.equal(formattedText(event, validateConfig({roomIds: [456]})), null);
    assert.equal(formattedText({...event, extra: {isFromPlugin: true}}, validateConfig({})), null);
    for (const authorName of ['', '  ', null, 1]) {
      assert.equal(formattedText({...event, data: {authorName}}, validateConfig({})), null);
    }
  });
}

test('skips only entry announcements for exact names in ignoredEnterUsers', () => {
  const config = validateConfig({ignoredEnterUsers: ['小明', '小红']});
  const enter = authorName => formattedText({cmd: Command.ENTER, data: {authorName}}, config);
  assert.equal(enter('小明'), null);
  assert.equal(enter('小红'), null);
  assert.equal(enter('小明同学'), '小明同学进入了直播间');
  assert.equal(formattedText(danmaku(), config), '小明说，你好');
  assert.equal(formattedText({cmd: Command.FOLLOW, data: {authorName: '小明'}}, config), '小明关注了直播间');
});

test('serializes speech, drops oldest pending messages, survives failures and stops pending work', async () => {
  const spoken = [];
  const errors = [];
  let release;
  let cancelled = false;
  const queue = new SpeechQueue({maxQueueSize: 2, maxAgeSeconds: 30, onError: error => errors.push(error.message),
    speak: async ({text}) => {
      spoken.push(text);
      if (text === 'first') await new Promise(resolve => { release = resolve; });
      if (text === 'bad') throw new Error('speech failed');
    }, cancel: async () => { cancelled = true; },
  });
  for (const text of ['first', 'discarded', 'bad', 'last']) queue.enqueue({text});
  assert.deepEqual(spoken, ['first']);
  release();
  await nextTurn();
  assert.deepEqual(spoken, ['first', 'bad', 'last']);
  assert.deepEqual(errors, ['speech failed']);
  queue.enqueue({text: 'first'});
  queue.enqueue({text: 'never'});
  await queue.stop();
  release();
  await nextTurn();
  queue.enqueue({text: 'also never'});
  assert.equal(cancelled, true);
  assert.deepEqual(spoken, ['first', 'bad', 'last', 'first']);
});

test('skips stale speech waiting behind a long utterance', async () => {
  let now = 0;
  let release;
  const spoken = [];
  const queue = new SpeechQueue({maxQueueSize: 5, maxAgeSeconds: 1, now: () => now, cancel: async () => {},
    speak: async ({text}) => { spoken.push(text); await new Promise(resolve => { release = resolve; }); },
  });
  queue.enqueue({text: 'first'});
  queue.enqueue({text: 'expired'});
  now = 2000;
  release();
  await nextTurn();
  assert.deepEqual(spoken, ['first']);
  await queue.stop();
});

async function mockConnection(t, options = {}) {
  // Real HTTP upgrade and WebSocket framing over streams; no TCP listener required.
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const clientStream = Duplex.from({readable: incoming, writable: outgoing});
  const serverStream = Duplex.from({readable: outgoing, writable: incoming});
  const httpServer = http.createServer();
  const server = new WebSocketServer({server: httpServer});
  httpServer.emit('connection', serverStream);
  t.after(() => {
    for (const peer of server.clients) peer.terminate();
    clientStream.destroy();
    serverStream.destroy();
    server.close();
    httpServer.close();
  });
  const received = [];
  let stopped = false;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const connected = once(server, 'connection');
  const client = connectPlugin({port: 12450, token: 'test-token', config: validateConfig({}),
    createSocket: (url, settings) => new WebSocket(url, {...settings, createConnection: () => clientStream}),
    queue: {enqueue: ({text, author}) => received.push({text, author}), stop: async () => { stopped = true; }}, log: () => {},
    onStop: finish, ...options,
  });
  t.after(() => client.stop());
  const [peer, request] = await connected;
  return {client, peer, request, received, done, isStopped: () => stopped};
}

test('authenticates, waits for INIT, accepts binary JSON, sends heartbeat and stops on disconnect', {timeout: 5000}, async t => {
  const {peer, request, received, done, isStopped} = await mockConnection(t, {heartbeatMs: 20});
  assert.equal(request.headers.authorization, 'Bearer test-token');
  peer.send(JSON.stringify(danmaku('初始化前')));
  peer.send(Buffer.from(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1', blcVersion: '1.10.2'}})));
  peer.send('invalid json');
  peer.send(Buffer.from(JSON.stringify(danmaku())));
  const [raw] = await once(peer, 'message');
  assert.deepEqual(JSON.parse(raw.toString()), {cmd: 0, data: {}});
  assert.deepEqual(received, [{text: '小明说，你好', author: '小明'}]);
  peer.close();
  assert.equal(await done, undefined);
  assert.equal(isStopped(), true);
});

test('rejects an incompatible SDK before reading messages', {timeout: 5000}, async t => {
  const {peer, received, done} = await mockConnection(t);
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '2.0.0'}}));
  peer.send(JSON.stringify(danmaku()));
  assert.match((await done).message, /SDK/u);
  assert.deepEqual(received, []);
});

test('uses the resolved announcement language and the global fallback at playback', {timeout: 5000}, async t => {
  const catalog = createVoiceCatalog([
    {name: '中文', languageCode: 'zh_CN'}, {name: '日本語', languageCode: 'ja_JP'}, {name: '한국어', culture: 'ko-KR'},
  ]);
  const config = validateConfig({default: {voice: '中文'}, users: {'小明': {voice: '日本語'}}});
  const spoken = [];
  const queue = new SpeechQueue({...config, cancel: async () => {}, speak: message => speakAnnouncement(message, {
    config, catalog, say: (text, {voice}) => spoken.push([text, voice]),
  })});
  const {peer} = await mockConnection(t, {queue, config});
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  peer.send(JSON.stringify(danmaku('안녕')));
  peer.send(JSON.stringify({cmd: Command.SUPER_CHAT, data: {authorName: '小明', content: 'こんにちは', price: 30}}));
  peer.send(JSON.stringify(danmaku('Bonjour tout le monde')));
  peer.send(JSON.stringify({cmd: Command.LIKE, data: {authorName: '小明'}}));
  await once(peer, 'message');
  await nextTurn();
  assert.deepEqual(spoken, [
    ['小明', '中文'], ['님의 메시지. 안녕', '한국어'],
    ['小明', '中文'], ['さんから30人民元のスーパーチャットです。こんにちは', '日本語'],
    ['小明说，Bonjour tout le monde', '中文'], ['小明点赞了直播间', '中文'],
  ]);
});

for (const [cmd, label, text] of [[Command.FOLLOW, '关注', '小明关注了直播间'], [Command.LIKE, '点赞', '小明点赞了直播间']]) {
  test(`acknowledges ${label} delivery to the host log after queuing speech`, {timeout: 5000}, async t => {
    const {peer, received} = await mockConnection(t);
    peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
    peer.send(JSON.stringify({cmd, data: {authorName: '小明'}, extra: {roomId: 123}}));
    const [raw] = await once(peer, 'message');
    const acknowledgement = JSON.parse(raw.toString());
    assert.equal(acknowledgement.cmd, 30);
    assert.equal(acknowledgement.data.msg, `${label}事件已接收并加入语音队列`);
    assert.deepEqual(received, [{text, author: '小明'}]);
  });
}

test('preserves the author for SC, gifts and memberships when queuing speech', {timeout: 5000}, async t => {
  const {peer, received} = await mockConnection(t, {
    heartbeatMs: 20,
    config: validateConfig({events: {paidGift: true, member: true}}),
  });
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  peer.send(JSON.stringify({cmd: Command.SUPER_CHAT, data: {authorName: '小红', content: '加油', price: 30}}));
  peer.send(JSON.stringify({cmd: Command.GIFT, data: {authorName: '小绿', giftName: '礼物', totalCoin: 1000}}));
  peer.send(JSON.stringify({cmd: Command.MEMBER, data: {authorName: '小蓝', privilegeType: 3}}));
  await once(peer, 'message');
  assert.deepEqual(received, [
    {text: '小红发送了30元的醒目留言，加油', author: '小红'},
    {text: '小绿赠送了1个礼物', author: '小绿'},
    {text: '小蓝开通了舰长', author: '小蓝'},
  ]);
});

test('terminates when INIT or server heartbeat is missing', {timeout: 5000}, async t => {
  const first = await mockConnection(t, {initTimeoutMs: 50});
  assert.match((await first.done).message, /BLC_INIT/u);
  const second = await mockConnection(t, {timeoutMs: 50});
  second.peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  assert.match((await second.done).message, /心跳/u);
});

test('queues entries with the author voice and observes updated event switches and room filters', {timeout: 5000}, async t => {
  let config = validateConfig({});
  const {peer, received} = await mockConnection(t, {getConfig: () => config});
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  const event = {cmd: Command.ENTER, data: {authorName: '小明'}, extra: {roomId: 123}};
  peer.send(JSON.stringify(event));
  const [raw] = await once(peer, 'message');
  assert.equal(JSON.parse(raw.toString()).data.msg, '进场事件已接收并加入语音队列');
  config = validateConfig({events: {enter: false}, roomIds: [123]});
  peer.send(JSON.stringify({...event, extra: {roomId: 456}}));
  peer.send(JSON.stringify(event));
  const like = {...event, cmd: Command.LIKE};
  peer.send(JSON.stringify({...like, extra: {roomId: 456}}));
  peer.send(JSON.stringify(like));
  await once(peer, 'message');
  assert.deepEqual(received, [
    {text: '小明进入了直播间', author: '小明'},
    {text: '小明点赞了直播间', author: '小明'},
  ]);
});
