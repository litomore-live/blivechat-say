import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as nextTurn, setTimeout as delay} from 'node:timers/promises';
import test from 'node:test';
import {configPath, initializeConfig, loadConfig, speechOptions, validateConfig, validateVoices} from '../src/config.js';
import {watchConfig} from '../src/watch-config.js';
import {SpeechQueue} from '../src/queue.js';

const installedVoices = async () => [{name: 'Tingting'}, {name: 'Meijia'},
  {name: 'Siri Voice 2 (zh-CN)', identifier: 'siri-id', aliases: ['Siri']}];
const input = (voice = 'Tingting', userVoice = 'Meijia') => ({default: {voice}, users: {'小明': {voice: userVoice}}});

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
  assert.equal(config.templates.paidGift, '谢谢{author}');
  assert.equal(config.templates.enter, '{author}进入了直播间');
  assert.equal(config.templates.like, '{author}点赞了直播间');
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
  for (const voice of ['Tingting', 'siri-id', 'Siri']) await validateVoices(validateConfig(input(voice)), installedVoices);
  await assert.rejects(validateVoices(validateConfig(input('Missing')), installedVoices), /默认音色「Missing」不可用/u);
  await assert.rejects(validateVoices(validateConfig(input('Tingting', 'Missing')), installedVoices), /用户「小明」/u);
  await validateVoices(validateConfig({}), () => { throw new Error('empty config should not enumerate voices'); });
  const config = validateConfig(JSON.parse('{"default":{"voice":"Tingting","rate":180},"users":{"default":{"voice":"Meijia"},"#default":{"voice":"Siri"},"__proto__":{"voice":"Siri"}}}'));
  for (const author of ['#default', '__proto__']) assert.equal(speechOptions(config, 'darwin', author).voice, 'Siri');
  assert.equal(speechOptions(config, 'darwin', 'default').voice, 'Meijia');
  for (const author of [undefined, 'toString', '未配置']) {
    assert.deepEqual(speechOptions(config, 'darwin', author), {skipRunningCheck: true, voice: 'Tingting', rate: 180});
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
  for (let i = 0; i < 1000; i++) assert.equal(speechOptions(settings.config, 'darwin', '小明').voice, 'Meijia');
  assert.equal(enumerations, before);
  await writeFile(`${path}.tmp`, JSON.stringify({...input('Siri', 'Tingting'), templates: {enter: '欢迎{author}'}}));
  await rename(`${path}.tmp`, path);
  await until(() => settings.config.default.voice === 'Siri');
  const good = settings.config;
  for (const invalid of ['{"default":', JSON.stringify(input('Missing')), '{"templates":{"enter":"{typo}"}}']) {
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
    speak: async (text, author) => {
      spoken.push({text, voice: speechOptions(settings.config, 'darwin', author).voice});
      if (text === 'first') await new Promise(resolve => { release = resolve; });
    }});
  t.after(() => queue.stop());
  queue.enqueue('first', '小明');
  queue.enqueue('second', '小明');
  queue.enqueue('third', '其他用户');
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
  let loading = false;
  const settings = await watchConfig({path, intervalMs: 20, log: () => {}, getVoices: async () => {
    loading = true;
    await new Promise(resolve => { release = resolve; });
    return installedVoices();
  }});
  t.after(() => settings.close());
  await writeFile(path, JSON.stringify(input()));
  await until(() => loading);
  settings.close();
  release();
  await nextTurn();
  assert.equal(settings.config.default.voice, '');
});
