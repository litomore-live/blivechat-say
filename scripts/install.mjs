import {access, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {defaultConfigPath, initializeConfig} from '../src/config.js';

try {
  if (process.platform !== 'darwin') throw new Error('此本机安装脚本用于 macOS；其他系统请按 README 安装');
  const {values} = parseArgs({options: {blivechat: {type: 'string'}, 'dry-run': {type: 'boolean'}}});
  const source = await realpath(fileURLToPath(new URL('..', import.meta.url)));
  const host = await realpath(resolve(values.blivechat ?? join(dirname(source), 'blivechat')));
  await access(join(host, 'main.py'));
  await access(join(source, 'node_modules/native-say/package.json'));
  await access(join(source, 'node_modules/raycast-language-detector/package.json'));
  await access(join(source, 'node_modules/ws/package.json'));
  await access(join(dirname(source), 'voices/src/index.js'));
  await access(join(dirname(source), 'voices/node_modules/native-say/package.json'));
  const destination = join(host, 'data/plugins/blivechat-say');
  // The host executes run through a shell. Quote paths as shell arguments.
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  // Node resolves Homebrew symlinks in execPath; keep the installed command
  // independent of the Cellar version, which brew upgrades can remove.
  let node = process.execPath;
  const homebrew = node.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/);
  if (homebrew) {
    for (const candidate of [join(homebrew[1], 'bin/node'), join(homebrew[1], 'opt', homebrew[2], 'bin/node')]) {
      try {
        if (await realpath(candidate) === process.execPath) {
          node = candidate;
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
  const entry = quote(join(source, 'src/index.js'));
  manifest.run = `${quote(node)} ${entry}`;
  manifest.enabled = true;
  try {
    const existing = JSON.parse(await readFile(join(destination, 'plugin.json'), 'utf8'));
    const oldNode = typeof existing.run === 'string' && existing.run.endsWith(` ${entry}`)
      ? existing.run.slice(0, -entry.length - 1) : '';
    const oldHomebrew = /^'\/(?:opt\/homebrew|usr\/local)\/Cellar\/node(?:@\d+)?\/[^'/]+\/bin\/node'$/.test(oldNode);
    if (existing.run !== manifest.run && existing.run !== `${quote(process.execPath)} ${entry}` && !oldHomebrew) {
      throw new Error(`目标已有不同的插件，请先检查：${destination}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (values['dry-run']) {
    console.log(JSON.stringify({destination, manifest}, null, 2));
  } else {
    const configPath = await initializeConfig({path: process.env.BLIVECHAT_SAY_CONFIG ? resolve(process.env.BLIVECHAT_SAY_CONFIG) : defaultConfigPath});
    await mkdir(destination, {recursive: true});
    await writeFile(join(destination, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`配置文件：${configPath}`);
    console.log(`已注册并启用插件：${destination}`);
    console.log('请重启 blivechat 一次，然后开启“通过服务器转发消息”。');
  }
} catch (error) {
  console.error(`安装未完成：${error.message}`);
  process.exitCode = 1;
}
