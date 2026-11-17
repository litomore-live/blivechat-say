import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {say, getVoices, killRunningSay} from '../../voices/src/index.js';
import {defaultConfigPath, initializeConfig, loadConfig, speechOptions, validateVoices} from './config.js';
import {watchConfig} from './watch-config.js';
import {cleanText} from './messages.js';
import {SpeechQueue} from './queue.js';
import {connectPlugin} from './client.js';

async function main() {
  const {values} = parseArgs({options: {
    config: {type: 'string'}, voices: {type: 'boolean'}, test: {type: 'string'}, check: {type: 'boolean'},
    'init-config': {type: 'boolean'}, help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log(`用法：node src/index.js [--config 文件] [--voices | --test "你好" | --check | --init-config]\n默认配置：${defaultConfigPath}`);
    return;
  }
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('仅支持 macOS 和 Windows');
  if (values.voices) {
    console.table(await getVoices());
    return;
  }
  const explicitPath = values.config || process.env.BLIVECHAT_SAY_CONFIG;
  const path = explicitPath ? resolve(explicitPath) : defaultConfigPath;
  if (!explicitPath || values['init-config']) await initializeConfig({path});
  if (values['init-config']) {
    console.log(`配置已就绪：${path}`);
    return;
  }
  if (values.check || values.test !== undefined) {
    const config = await loadConfig(path);
    await validateVoices(config, getVoices);
    if (values.check) {
      console.log(`配置检查通过：${path}`);
      return;
    }
    const text = cleanText(values.test, config.maxLength);
    if (!text) throw new Error('试听文本不能为空');
    const stop = () => { void killRunningSay().finally(() => process.exit(0)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await say(text, speechOptions(config));
    return;
  }
  let queue;
  const settings = await watchConfig({path, getVoices, onChange: config => {
    if (queue) {
      queue.maxQueueSize = config.maxQueueSize;
      queue.maxAgeSeconds = config.maxAgeSeconds;
      if (queue.pending.length > config.maxQueueSize) queue.pending.splice(0, queue.pending.length - config.maxQueueSize);
    }
  }});
  queue = new SpeechQueue({
    ...settings.config,
    speak: (text, author) => say(text, speechOptions(settings.config, process.platform, author)),
    cancel: killRunningSay,
    onError: error => console.error(`播报失败：${error.message}`),
  });
  let client;
  try {
    client = connectPlugin({
      port: process.env.BLC_PORT, token: process.env.BLC_TOKEN, getConfig: () => settings.config, configPath: path, queue,
      onStop: error => {
        settings.close();
        if (error) console.error(error.message);
        else console.log('blivechat 已断开，插件退出');
        process.exit(error ? 1 : 0);
      },
    });
  } catch (error) {
    settings.close();
    throw error;
  }
  process.once('SIGINT', () => { void client.stop(); });
  process.once('SIGTERM', () => { void client.stop(); });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
