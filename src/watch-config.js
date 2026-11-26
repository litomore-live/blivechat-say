import {stat} from 'node:fs/promises';
import {loadConfig, validateVoices} from './config.js';
import {createVoiceCatalog} from './voice-selection.js';

async function signature(path) {
  try {
    const info = await stat(path, {bigint: true});
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

export async function watchConfig({path, getVoices, intervalMs = 300, onChange = () => {},
  log = console.log, onError = console.error}) {
  let config;
  let catalog;
  let closed = false;
  let checking = false;
  // Record metadata before reading so saves during the initial read are observed too.
  let previous = await signature(path);

  async function reload() {
    const next = await loadConfig(path);
    const nextCatalog = createVoiceCatalog(await getVoices());
    validateVoices(next, nextCatalog);
    if (closed) return;
    config = next;
    catalog = nextCatalog;
    onChange(next);
    log(`配置已加载：${path}（${Object.keys(config.users).length} 位用户）`);
  }
  await reload();

  // Stat polling survives atomic saves, deletion/recreation and unavailable native watchers.
  // Reads and voice enumeration happen only after metadata changes, never per message.
  const timer = setInterval(async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const current = await signature(path);
      if (closed || current === previous) return;
      previous = current;
      await reload();
    } catch (error) {
      if (!closed) onError(`配置加载失败，保留上一份有效配置：${path}：${error.message}`);
    } finally {
      checking = false;
    }
  }, intervalMs);

  return {
    get config() { return config; },
    get catalog() { return catalog; },
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}
