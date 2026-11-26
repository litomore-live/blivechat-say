import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as nextTurn, setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {configPath, initializeConfig, loadConfig, speechOptions, validateConfig, validateVoices} from '../src/config.js';
import {watchConfig} from '../src/watch-config.js';
import {SpeechQueue} from '../src/queue.js';
import {createVoiceCatalog} from '../src/voice-selection.js';

const installedVoices = async () => [{name: 'Tingting'}, {name: 'Meijia'},
  {name: 'Siri Voice 2 (zh-CN)', identifier: 'siri-id', aliases: ['Siri']}];
const input = (voice = 'Tingting', userVoice = 'Meijia') => ({default: {voice}, users: {'小明': {voice: userVoice}}});

test('reads legacy templates only as event switches and honors explicit event settings', () => {
  const config = validateConfig({
    templates: {like: '', paidGift: '谢谢{author}', follow: '', text: '旧文案'},
    events: {follow: true},
  });
  assert.deepEqual(config.events, {text: true, enter: true, like: false, follow: true, superChat: true,
    paidGift: true, freeGift: false, member: false});
  assert.equal('templates' in config, false);
  assert.throws(() => validateConfig({events: {unknown: false}}));
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'blivechat-say-config-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return join(directory, 'config.json');
}
async function until(predicate) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'timed out waiting for config reload');
    await delay(10);
  }
}

test('resolves the shared config location and ignores relative XDG paths', () => {
  assert.equal(configPath({}, '/home/test'), '/home/test/.config/blivechat-say/config.json');
  assert.equal(configPath({XDG_CONFIG_HOME: '/custom'}, '/home/test'), '/custom/blivechat-say/config.json');
  assert.equal(configPath({XDG_CONFIG_HOME: 'relative'}, '/home/test'), '/home/test/.config/blivechat-say/config.json');
});

test('migrates both old files once, preserves precedence and never overwrites the destination', async t => {
  const path = await fixture(t);
  const legacyDirectory = join(path, '..', 'legacy');
  await mkdir(legacyDirectory);
  const original = '{"voice":"Meijia","rate":180,"templates":{"paidGift":"谢谢{author}"},"followWebFallback":false}';
  await writeFile(join(legacyDirectory, 'config.json'), original);
  await writeFile(join(legacyDirectory, 'user-voices.json'), '{"#default":"Tingting","小明":"Meijia","__proto__":"Siri"}');
  await initializeConfig({path, legacyDirectory});
  const config = await loadConfig(path);
  assert.equal(config.default.voice, 'Tingting');
  assert.equal(config.default.rate, 180);
  assert.equal(config.events.paidGift, true);
  assert.equal('templates' in config, false);
  assert.equal(config.events.enter, true);
  assert.equal(config.events.like, true);
  assert.equal(config.followWebFallback, false);
  assert.equal(config.users['小明'].voice, 'Meijia');
  assert.equal(config.users.__proto__.voice, 'Siri');
  assert.equal(await readFile(join(legacyDirectory, 'config.json'), 'utf8'), original);
  await writeFile(path, '{}');
  await writeFile(join(legacyDirectory, 'config.json'), 'invalid');
  await initializeConfig({path, legacyDirectory});
  assert.equal(await readFile(path, 'utf8'), '{}');
});

test('initializes absent directories and rejects invalid legacy configs before creating a config', async t => {
  const root = await fixture(t);
  const path = join(root, 'nested/config.json');
  await initializeConfig({path, legacyDirectory: join(root, 'missing')});
  assert.equal((await loadConfig(path)).default.voice, '');
  const legacyDirectory = join(root, 'legacy');
  await mkdir(legacyDirectory);
  for (const invalid of ['null', '[]', '{"voice":42}', '{"unknown":true}']) {
    await rm(path);
    await writeFile(join(legacyDirectory, 'config.json'), invalid);
    await assert.rejects(initializeConfig({path, legacyDirectory}));
    await assert.rejects(readFile(path), {code: 'ENOENT'});
    await writeFile(path, '{}');
  }
});

test('validates nested fields and installed names, identifiers and aliases', async () => {
  for (const ignoredEnterUsers of ['小明', null, ['小明', 42], ['  ']]) {
    assert.throws(() => validateConfig({ignoredEnterUsers}), /ignoredEnterUsers/u);
  }
  for (const invalid of [[], null, 42, {voice: 'Tingting'}, {default: []}, {default: {typo: 1}},
    {users: []}, {users: {'小明': 'Meijia'}}, {users: {'小明': {}}}, {users: {'小明': {voice: ''}}},
    {users: {' ': {voice: 'Tingting'}}}, {users: {'小明': {voice: 'Tingting', rate: 10}}}]) {
    assert.throws(() => validateConfig(invalid));
  }
  const catalog = createVoiceCatalog(await installedVoices());
  for (const voice of ['Tingting', 'siri-id', 'Siri']) validateVoices(validateConfig(input(voice)), catalog);
  assert.throws(() => validateVoices(validateConfig(input('Missing')), catalog), /默认音色「Missing」不可用/u);
  assert.throws(() => validateVoices(validateConfig(input('Tingting', 'Missing')), catalog), /用户「小明」/u);
  validateVoices(validateConfig({}), catalog);
  const config = validateConfig(JSON.parse('{"default":{"voice":"Tingting","rate":180},"users":{"default":{"voice":"Meijia"},"#default":{"voice":"Siri"},"__proto__":{"voice":"Siri"}}}'));
  for (const author of ['#default', '__proto__']) assert.equal(speechOptions(config, {platform: 'darwin', author}).voice, 'Siri');
  assert.equal(speechOptions(config, {platform: 'darwin', author: 'default'}).voice, 'Meijia');
  for (const author of [undefined, 'toString', '未配置']) {
    assert.deepEqual(speechOptions(config, {platform: 'darwin', author}), {skipRunningCheck: true, voice: 'Tingting', rate: 180});
  }
});

test('reloads atomic saves, caches speech lookups and retains the last valid whole config on errors/deletion', {timeout: 10000}, async t => {
  const path = await fixture(t);
  await writeFile(path, JSON.stringify(input()));
  const errors = [];
  let enumerations = 0;
  const settings = await watchConfig({path, intervalMs: 20, log: () => {}, onError: error => errors.push(error),
    getVoices: async () => { enumerations++; return installedVoices(); }});
  t.after(() => settings.close());
  const before = enumerations;
  for (let i = 0; i < 1000; i++) assert.equal(speechOptions(settings.config, {platform: 'darwin', author: '小明'}).voice, 'Meijia');
  assert.equal(enumerations, before);
  await writeFile(`${path}.tmp`, JSON.stringify({...input('Siri', 'Tingting'), events: {enter: false}}));
  await rename(`${path}.tmp`, path);
  await until(() => settings.config.default.voice === 'Siri');
  const good = settings.config;
  for (const invalid of ['{"default":', JSON.stringify(input('Missing')), '{"events":{"enter":"false"}}']) {
    const count = errors.length;
    await writeFile(path, invalid);
    await until(() => errors.length > count);
    assert.equal(settings.config, good);
  }
  const count = errors.length;
  await rm(path);
  await until(() => errors.length > count);
  assert.equal(settings.config, good);
  await writeFile(path, '{}');
  await until(() => settings.config.default.voice === '');
  assert.deepEqual(settings.config.users, {});
});

test('fails initial invalid configs and closes its watcher', async t => {
  const path = await fixture(t);
  await writeFile(path, 'invalid');
  await assert.rejects(watchConfig({path, getVoices: installedVoices}));
  await writeFile(path, JSON.stringify(input('Missing')));
  await assert.rejects(watchConfig({path, getVoices: installedVoices}), /不可用/u);
});

test('queued authors use the latest default and user voices while current speech continues', async t => {
  const path = await fixture(t);
  await writeFile(path, JSON.stringify(input()));
  const settings = await watchConfig({path, getVoices: installedVoices, intervalMs: 20, log: () => {}});
  t.after(() => settings.close());
  const spoken = [];
  let release;
  const queue = new SpeechQueue({maxQueueSize: 5, maxAgeSeconds: 30, cancel: async () => {},
    speak: async ({text, author}) => {
      spoken.push({text, voice: speechOptions(settings.config, {platform: 'darwin', author}).voice});
      if (text === 'first') await new Promise(resolve => { release = resolve; });
    }});
  t.after(() => queue.stop());
  queue.enqueue({text: 'first', author: '小明'});
  queue.enqueue({text: 'second', author: '小明'});
  queue.enqueue({text: 'third', author: '其他用户'});
  await writeFile(path, JSON.stringify(input('Meijia', 'Siri')));
  await until(() => settings.config.default.voice === 'Meijia');
  assert.deepEqual(spoken, [{text: 'first', voice: 'Meijia'}]);
  release();
  await nextTurn();
  assert.deepEqual(spoken, [{text: 'first', voice: 'Meijia'}, {text: 'second', voice: 'Siri'}, {text: 'third', voice: 'Meijia'}]);
});

test('closing the watcher prevents an in-flight reload from applying', async t => {
  const path = await fixture(t);
  await writeFile(path, '{}');
  let release;
  let enumerations = 0;
  const settings = await watchConfig({path, intervalMs: 20, log: () => {}, getVoices: async () => {
    enumerations++;
    if (enumerations > 1) await new Promise(resolve => { release = resolve; });
    return installedVoices();
  }});
  t.after(() => settings.close());
  assert.equal(enumerations, 1, 'enumerates voices on startup even with no configured voice');
  await writeFile(path, JSON.stringify(input()));
  await until(() => release);
  settings.close();
  release();
  await nextTurn();
  assert.equal(settings.config.default.voice, '');
});
