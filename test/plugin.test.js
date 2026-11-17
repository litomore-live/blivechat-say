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

function danmaku(content = '你好', extra = {}) {
  return {cmd: Command.TEXT, data: ['', 1, '小明', 0, content, 0, false, 1, false, true, 0, 'id', '', 0, {}, 0, 'uid', '', false], extra};
}

test('decodes actual SDK array positions and excludes synthetic, mirrored, gift and emoticon messages', () => {
  const config = validateConfig({});
  assert.equal(formatMessage(danmaku(), config), '小明说，你好');
  assert.equal(formatMessage(danmaku('你好', {isFromPlugin: true}), config), null);
  for (const [index, value] of [[6, true], [13, 1], [18, true]]) {
    const message = danmaku();
    message.data[index] = value;
    assert.equal(formatMessage(message, config), null);
  }
  const oldMessage = danmaku();
  oldMessage.data.pop(); // Before SDK added isMirror.
  assert.equal(formatMessage(oldMessage, config), '小明说，你好');
  assert.equal(formatMessage(danmaku('   '), config), null);
  const filtered = validateConfig({roomIds: [123]});
  assert.equal(formatMessage(danmaku('你好', {roomId: 456}), filtered), null);
  assert.equal(formatMessage(danmaku('你好', {roomId: 123}), filtered), '小明说，你好');
});

test('formats SC, paid/free gifts and guard ranks with opt-in templates', () => {
  const config = validateConfig({templates: {paidGift: '{author}送了{num}个{gift}，{price}元', member: '{author}成为{guard}'}});
  assert.equal(formatMessage({cmd: Command.SUPER_CHAT, data: {authorName: '小明', content: '加油', price: 30}}, config), '小明发送了30元的醒目留言，加油');
  const gift = {cmd: Command.GIFT, data: {authorName: '小明', num: 2, giftName: '礼物', totalCoin: 2000}};
  assert.equal(formatMessage(gift, config), '小明送了2个礼物，2元');
  gift.data.totalCoin = 0;
  assert.equal(formatMessage(gift, config), null);
  for (const [privilegeType, name] of [[1, '总督'], [2, '提督'], [3, '舰长']]) {
    assert.equal(formatMessage({cmd: Command.MEMBER, data: {authorName: '小明', privilegeType}}, config), `小明成为${name}`);
  }
});

test('normalizes speech and validates platform-specific options and templates', () => {
  assert.equal(cleanText(' A\n\u0000 B [[rate 900]]', 100), 'A B ［［rate 900］］');
  assert.equal(cleanText('😀你好', 2), '😀你…');
  assert.throws(() => validateConfig({maxQueueSize: 0}));
  assert.throws(() => validateConfig({templates: {text: '{typo}'}}));
  assert.throws(() => validateConfig({templates: []}));
  assert.throws(() => validateConfig({default: {rate: 200}}, 'win32'));
  assert.throws(() => validateConfig({default: {volume: 50}}, 'darwin'));
  assert.throws(() => validateConfig({default: {audioDevice: '1'}}, 'win32'));
  const config = validateConfig({default: {rate: 0, volume: 50}}, 'win32');
  assert.deepEqual(speechOptions(config, 'win32'), {skipRunningCheck: true, rate: 0, volume: 50});
});

for (const [cmd, template, text] of [[Command.FOLLOW, 'follow', '小明关注了直播间'], [Command.ENTER, 'enter', '小明进入了直播间'],
  [Command.LIKE, 'like', '小明点赞了直播间']]) {
  test(`announces ${template} events and honors template, room and plugin filters`, () => {
    const event = {cmd, data: {authorName: '小明'}, extra: {roomId: 123}};
    assert.equal(formatMessage(event, validateConfig({})), text);
    assert.equal(formatMessage(event, validateConfig({templates: {[template]: ''}})), null);
    assert.equal(formatMessage(event, validateConfig({roomIds: [456]})), null);
    assert.equal(formatMessage({...event, extra: {isFromPlugin: true}}, validateConfig({})), null);
    for (const authorName of ['', '  ', null, 1]) {
      assert.equal(formatMessage({...event, data: {authorName}}, validateConfig({})), null);
    }
  });
}

test('serializes speech, drops oldest pending messages, survives failures and stops pending work', async () => {
  const spoken = [];
  const errors = [];
  let release;
  let cancelled = false;
  const queue = new SpeechQueue({maxQueueSize: 2, maxAgeSeconds: 30, onError: error => errors.push(error.message),
    speak: async text => {
      spoken.push(text);
      if (text === 'first') await new Promise(resolve => { release = resolve; });
      if (text === 'bad') throw new Error('speech failed');
    }, cancel: async () => { cancelled = true; },
  });
  for (const text of ['first', 'discarded', 'bad', 'last']) queue.enqueue(text);
  assert.deepEqual(spoken, ['first']);
  release();
  await nextTurn();
  assert.deepEqual(spoken, ['first', 'bad', 'last']);
  assert.deepEqual(errors, ['speech failed']);
  queue.enqueue('first');
  queue.enqueue('never');
  await queue.stop();
  release();
  await nextTurn();
  queue.enqueue('also never');
  assert.equal(cancelled, true);
  assert.deepEqual(spoken, ['first', 'bad', 'last', 'first']);
});

test('skips stale speech waiting behind a long utterance', async () => {
  let now = 0;
  let release;
  const spoken = [];
  const queue = new SpeechQueue({maxQueueSize: 5, maxAgeSeconds: 1, now: () => now, cancel: async () => {},
    speak: async text => { spoken.push(text); await new Promise(resolve => { release = resolve; }); },
  });
  queue.enqueue('first');
  queue.enqueue('expired');
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
    queue: {enqueue: (text, author) => received.push({text, author}), stop: async () => { stopped = true; }}, log: () => {},
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
    config: validateConfig({templates: {paidGift: '{author}送了{gift}', member: '{author}开通{guard}'}}),
  });
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  peer.send(JSON.stringify({cmd: Command.SUPER_CHAT, data: {authorName: '小红', content: '加油', price: 30}}));
  peer.send(JSON.stringify({cmd: Command.GIFT, data: {authorName: '小绿', giftName: '礼物', totalCoin: 1000}}));
  peer.send(JSON.stringify({cmd: Command.MEMBER, data: {authorName: '小蓝', privilegeType: 3}}));
  await once(peer, 'message');
  assert.deepEqual(received, [
    {text: '小红发送了30元的醒目留言，加油', author: '小红'},
    {text: '小绿送了礼物', author: '小绿'},
    {text: '小蓝开通舰长', author: '小蓝'},
  ]);
});

test('terminates when INIT or server heartbeat is missing', {timeout: 5000}, async t => {
  const first = await mockConnection(t, {initTimeoutMs: 50});
  assert.match((await first.done).message, /BLC_INIT/u);
  const second = await mockConnection(t, {timeoutMs: 50});
  second.peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  assert.match((await second.done).message, /心跳/u);
});

test('queues entries with the author voice and observes updated templates and room filters', {timeout: 5000}, async t => {
  let config = validateConfig({});
  const {peer, received} = await mockConnection(t, {getConfig: () => config});
  peer.send(JSON.stringify({cmd: Command.INIT, data: {sdkVersion: '1.0.1'}}));
  const event = {cmd: Command.ENTER, data: {authorName: '小明'}, extra: {roomId: 123}};
  peer.send(JSON.stringify(event));
  const [raw] = await once(peer, 'message');
  assert.equal(JSON.parse(raw.toString()).data.msg, '进场事件已接收并加入语音队列');
  config = validateConfig({templates: {enter: '欢迎{author}'}, roomIds: [123]});
  peer.send(JSON.stringify({...event, extra: {roomId: 456}}));
  peer.send(JSON.stringify(event));
  await once(peer, 'message');
  assert.deepEqual(received, [
    {text: '小明进入了直播间', author: '小明'},
    {text: '欢迎小明', author: '小明'},
  ]);
});
