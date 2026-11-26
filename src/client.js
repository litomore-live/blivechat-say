import WebSocket from 'ws';
import {Command, formatMessage} from './messages.js';

export function connectPlugin({port, token, config, getConfig = () => config, configPath = '所使用的 config.json', queue, log = console.log, onStop = () => {}, heartbeatMs = 30_000, timeoutMs = 35_000, initTimeoutMs = 10_000,
  createSocket = (url, options) => new WebSocket(url, options)}) {
  if (!/^\d+$/u.test(String(port)) || Number(port) < 1 || Number(port) > 65535 || !token) {
    throw new Error('缺少或无效的 BLC_PORT / BLC_TOKEN；请从 blivechat 启动插件');
  }
  const socket = createSocket(`ws://localhost:${port}/api/plugin/websocket`, {
    headers: {Authorization: `Bearer ${token}`},
    handshakeTimeout: initTimeoutMs,
    maxPayload: 1024 * 1024,
    followRedirects: false,
  });
  let initialized = false;
  let stopped = false;
  let heartbeat;
  let receiveTimeout;
  const initTimeout = setTimeout(() => stop(new Error('等待 BLC_INIT 超时')), initTimeoutMs);

  function stop(error) {
    if (stopped) return;
    stopped = true;
    clearTimeout(initTimeout);
    clearTimeout(receiveTimeout);
    clearInterval(heartbeat);
    socket.terminate();
    return Promise.resolve(queue.stop()).catch(cancelError => {
      error ??= cancelError;
    }).then(() => onStop(error));
  }

  socket.on('open', () => {
    heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({cmd: Command.HEARTBEAT, data: {}}));
    }, heartbeatMs);
  });
  socket.on('message', raw => {
    if (stopped) return;
    clearTimeout(receiveTimeout);
    receiveTimeout = setTimeout(() => stop(new Error('blivechat 心跳超时')), timeoutMs);
    let message;
    try {
      // Tornado may send JSON as binary frames; both binary and text are UTF-8 JSON.
      message = JSON.parse(raw.toString());
    } catch {
      log('忽略无效的 JSON 消息');
      return;
    }
    if (!initialized) {
      if (message?.cmd !== Command.INIT) return;
      if (!/^1\.\d+\.\d+/u.test(message.data?.sdkVersion ?? '')) {
        void stop(new Error('不兼容的 blivechat 插件 SDK 版本（需要 1.x）'));
        return;
      }
      initialized = true;
      clearTimeout(initTimeout);
      log(`已连接 blivechat ${message.data.blcVersion}，语音播报已就绪`);
      return;
    }
    if (message?.cmd === Command.ADMIN) {
      log(`请编辑 ${configPath}，保存后自动加载；followWebFallback 的修改需重启宿主`);
      return;
    }
    const announcement = formatMessage(message, getConfig());
    if (announcement) {
      queue.enqueue(announcement, {allowRepeat: message.cmd === Command.GIFT});
      if ([Command.FOLLOW, Command.ENTER, Command.LIKE].includes(message.cmd)) {
        const label = {[Command.FOLLOW]: '关注', [Command.ENTER]: '进场', [Command.LIKE]: '点赞'}[message.cmd];
        socket.send(JSON.stringify({cmd: 30, data: {level: 20, msg: `${label}事件已接收并加入语音队列`}}));
      }
    }
  });
  socket.on('error', error => { void stop(new Error(`连接 blivechat 失败：${error.message}`)); });
  socket.on('close', () => { void stop(initialized ? undefined : new Error('blivechat 在初始化前断开连接')); });
  return {stop, socket};
}
