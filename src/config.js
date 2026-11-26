import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function configPath(env = process.env, home = homedir()) {
  const base = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(base, 'blivechat-say', 'config.json');
}

export const defaultConfigPath = configPath();
const defaults = JSON.parse(await readFile(new URL('../config.example.json', import.meta.url), 'utf8'));
const speechKeys = ['voice', 'rate', 'audioDevice', 'volume'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateConfig(input, platform = process.platform) {
  if (!isObject(input)) throw new Error('配置必须是 JSON 对象');
  // Older configs used an empty template to turn off an event.
  const {templates, ...settings} = input;
  for (const key of Object.keys(settings)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`未知配置项：${key}`);
  }
  for (const key of ['default', 'users', 'templates', 'events']) {
    if (input[key] !== undefined && !isObject(input[key])) throw new Error(`${key} 必须是对象`);
  }
  const events = {...defaults.events};
  for (const [key, template] of Object.entries(templates ?? {})) {
    if (!Object.hasOwn(events, key) || typeof template !== 'string') throw new Error(`无效的旧模板：${key}`);
    events[key] = template.length > 0;
  }
  for (const [key, enabled] of Object.entries(settings.events ?? {})) {
    if (!Object.hasOwn(events, key) || typeof enabled !== 'boolean') throw new Error(`无效的播报开关：${key}`);
    events[key] = enabled;
  }
  const config = {...defaults, ...settings, default: {...defaults.default, ...settings.default}, users: {...settings.users}, events};
  for (const key of Object.keys(config.default)) {
    if (!speechKeys.includes(key)) throw new Error(`未知默认声音配置项：${key}`);
  }
  if (typeof config.followWebFallback !== 'boolean') throw new Error('followWebFallback 必须是布尔值');
  if (!Array.isArray(config.ignoredEnterUsers) || !config.ignoredEnterUsers.every(name => typeof name === 'string' && name.trim())) {
    throw new Error('ignoredEnterUsers 必须是非空用户名组成的数组');
  }
  for (const key of ['voice', 'audioDevice']) {
    if (typeof config.default[key] !== 'string') throw new Error(`default.${key} 必须是字符串`);
  }
  for (const key of ['maxQueueSize', 'maxAgeSeconds', 'maxLength']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`${key} 必须是正整数`);
  }
  if (!Array.isArray(config.roomIds) || !config.roomIds.every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error('roomIds 必须是正整数数组');
  }
  const {rate, volume, audioDevice} = config.default;
  if (rate !== null && (!Number.isInteger(rate) || (platform === 'win32' ? rate < -10 || rate > 10 : rate <= 0))) {
    throw new Error(platform === 'win32' ? 'Windows rate 必须是 -10 到 10 的整数' : 'macOS rate 必须是正整数');
  }
  if (volume !== null && (!Number.isInteger(volume) || volume < 0 || volume > 100)) throw new Error('volume 必须是 0 到 100 的整数');
  if (platform === 'darwin' && volume !== null) throw new Error('volume 仅支持 Windows；macOS 请调整系统音量');
  if (platform === 'win32' && audioDevice) throw new Error('audioDevice 仅支持 macOS');
  for (const [author, settings] of Object.entries(config.users)) {
    if (!author.trim() || !isObject(settings) || Object.keys(settings).some(key => key !== 'voice') ||
      typeof settings.voice !== 'string' || !settings.voice.trim()) {
      throw new Error('users 中每位用户必须配置非空的 voice，且只支持 voice 字段');
    }
  }
  return config;
}

export async function loadConfig(path = defaultConfigPath) {
  return validateConfig(JSON.parse(await readFile(path, 'utf8')));
}

export function validateVoices(config, catalog) {
  const entries = [['默认', config.default.voice], ...Object.entries(config.users).map(([author, settings]) => [`用户「${author}」的`, settings.voice])];
  for (const [label, voice] of entries) {
    if (voice && !catalog.has(voice)) throw new Error(`${label}音色「${voice}」不可用，请运行 npm run voices 查看完整名称`);
  }
}

export function speechOptions(config, {platform = process.platform, author, catalog, language, autoSelectVoice = false} = {}) {
  const {voice, rate, audioDevice, volume} = config.default;
  const preferred = typeof author === 'string' && Object.hasOwn(config.users, author) ? config.users[author].voice : voice;
  const selectedVoice = catalog && (preferred || autoSelectVoice) ? catalog.select(preferred, language, voice) : preferred;
  const options = {skipRunningCheck: true};
  if (selectedVoice) options.voice = selectedVoice;
  if (rate !== null) options.rate = rate;
  if (platform === 'darwin' && audioDevice) options.audioDevice = audioDevice;
  if (platform === 'win32' && volume !== null) options.volume = volume;
  return options;
}

async function optionalJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

// Copy settings once without changing the original files or overwriting an existing config.
export async function initializeConfig({path = defaultConfigPath,
  legacyDirectory = fileURLToPath(new URL('..', import.meta.url))} = {}) {
  try { await readFile(path, 'utf8'); return path; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacyInput = await optionalJSON(join(legacyDirectory, 'config.json'));
  const voicesInput = await optionalJSON(join(legacyDirectory, 'user-voices.json'));
  const legacy = legacyInput === undefined ? {} : legacyInput;
  const voices = voicesInput === undefined ? {} : voicesInput;
  if (!isObject(legacy) || !isObject(voices)) throw new Error('旧配置必须是 JSON 对象');
  const input = {...legacy};
  const speech = {};
  for (const key of speechKeys) {
    if (Object.hasOwn(input, key)) { speech[key] = input[key]; delete input[key]; }
  }
  const users = {};
  for (const [author, voice] of Object.entries(voices)) {
    if (!author.trim() || typeof voice !== 'string' || !voice.trim()) throw new Error('旧用户音色配置无效');
    if (author === '#default') speech.voice = voice;
    else Object.defineProperty(users, author, {value: {voice}, enumerable: true});
  }
  const config = validateConfig({...input, default: {...speech, ...input.default}, users: {...users, ...input.users}});
  await mkdir(dirname(path), {recursive: true});
  try { await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {flag: 'wx'}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return path;
}
