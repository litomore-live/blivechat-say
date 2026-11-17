# blivechat-say

使用本地 [voices](../voices)（封装 [native-say](https://github.com/LitoMore/native-say) 与 Siri 音色）为 [blivechat](https://github.com/xfgryujk/blivechat) 提供系统原生语音播报。macOS 调用内置 `say` 或 Swift / AVSpeechSynthesizer，Windows 调用 PowerShell / SpeechSynthesizer，无需云端 TTS 服务。

## 环境

- Node.js 22 或更新版本。
- macOS 或 Windows，已安装想使用的系统声音。
- 支持插件系统的 blivechat；当前按插件 SDK 1.x 协议实现。
- 插件与音频输出运行在 **blivechat 后端所在的电脑**。Docker、远程服务器不会直接在你的 Mac 上发声。

## 安装与试听

在本项目目录运行：

```sh
npm ci
npm run config:init
npm run voices
npm start -- --test "你好，语音播报测试。"
```

此本地版本要求相邻的 `../voices` 项目，先在该目录运行 `npm ci`；macOS 使用 Siri 声音还需要 Xcode Command Line Tools 提供的 Swift。无需发布到 npm 或运行 `npm link`。

`npm run config:init` 会创建 `~/.config/blivechat-say/config.json`；Windows 使用用户主目录下的 `.config\blivechat-say\config.json`。设置了绝对路径的 `XDG_CONFIG_HOME` 时，使用 `$XDG_CONFIG_HOME/blivechat-say/config.json`。`npm run voices` 会列出本机安装的声音；将声音的完整 `name` 或 `identifier` 填入配置的 `default.voice`，空字符串使用系统默认声音。macOS 中文声音可在系统设置的辅助功能相关语音设置中下载；以本机列出的名字为准。

## 接入 blivechat

macOS 开发环境下，如果本项目与 blivechat 位于同一父目录，可以直接运行：

```sh
npm run install:plugin
```

脚本在 blivechat 插件目录创建启用状态的 `plugin.json`，使用当前 Node 和本项目入口的绝对路径。项目保留在原位置，不需要复制依赖。自定义宿主位置可用 `npm run install:plugin -- --blivechat /path/to/blivechat`；加 `--dry-run` 可预览写入内容。安装后重启 blivechat 一次。

将整个项目放在 `blivechat/data/plugins/blivechat-say/` 下，并在这个目录运行 `npm ci`。目录应为：

```text
blivechat/data/plugins/blivechat-say/
├── plugin.json
├── package.json
├── package-lock.json
├── config.example.json
├── src/
└── node_modules/
```

macOS 本地开发也可以保持项目在当前位置，通过符号链接注册（替换成实际路径）：

```sh
ln -s /path/to/blivechat-say /path/to/blivechat/data/plugins/blivechat-say
```

1. 重启 blivechat，让它扫描插件目录。
2. 在插件管理中启用“原生语音播报”（初始为禁用）。
3. 在直播间配置中开启 **“通过服务器转发消息”**，连接直播间即可播报。
4. 配置保存在用户配置目录中，保存后自动加载。

如果日志提示找不到 `node`，用 `command -v node`（Windows 用 `where node`）找到绝对路径，修改 `plugin.json` 的 `run`，例如：

```json
"run": "\"/opt/homebrew/bin/node\" src/index.js"
```

独立运行 `npm start` 需要 blivechat 注入的 `BLC_PORT` 和 `BLC_TOKEN`；本地试听使用 `--test`，无需这些变量。

## 配置

统一配置文件默认位于 `~/.config/blivechat-say/config.json`，无需在项目目录保存个人配置。首次运行 `npm run config:init`、`npm start` 或 `npm run check` 时，会将项目中原有的 `config.json` 和 `user-voices.json` 合并复制到新位置；新文件已经存在时不会覆盖，旧文件保留作为备份。旧配置中的 `#default` 会迁移到 `default.voice`，优先于原来的全局 `voice`。没有旧配置时使用 `config.example.json` 的默认值。

```json
{
  "default": {
    "voice": "Panpan (Premium)",
    "rate": null,
    "audioDevice": "",
    "volume": null
  },
  "users": {
    "小明": {"voice": "Tingting (Chinese (China mainland))"},
    "小红": {"voice": "Meijia (Chinese (Taiwan))"}
  },
  "templates": {
    "enter": "{author}进入了直播间",
    "follow": "{author}关注了直播间",
    "like": "{author}点赞了直播间"
  }
}
```

音色名称以本机 `npm run voices` 输出为准。自定义配置可以只写需要覆盖的字段，未写的字段使用默认值；未知字段和无效值会报错。用 `--config /path/to/config.json` 指定其他文件，或设置 `BLIVECHAT_SAY_CONFIG` 环境变量；优先级为命令行 → 环境变量 → 默认路径。显式指定的文件必须存在，使用新格式；可用 `npm run config:init -- --config /path/to/config.json` 将旧配置迁移到指定位置。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `default.voice` | `""` | 默认系统声音名称或 identifier |
| `default.rate` | `null` | 系统默认语速；macOS 为每分钟词数的正整数，Windows 为 -10 到 10 |
| `default.audioDevice` | `""` | macOS 音频设备 ID 或名称，空值使用默认设备；可运行 `say --audio-device '?'` 查询 |
| `default.volume` | `null` | 仅 Windows，0 到 100；macOS 调整系统音量 |
| `users` | `{}` | 按完整用户名配置专属音色，每项为 `{"voice": "音色名称"}` |
| `maxQueueSize` | `5` | 等待队列长度，不含当前播报；满时丢弃最旧的待播消息 |
| `maxAgeSeconds` | `30` | 等待超过此秒数的消息不再播报 |
| `maxLength` | `120` | 每条完整播报的最大字符数，超出截断并加省略号 |
| `roomIds` | `[]` | 空数组播报所有房间；例如 `[123456]` 只播报该房间 |
| `followWebFallback` | `true` | 为身份码房间额外建立网页版连接，仅用于关注播报；修改后需重启宿主 |

`templates` 中把某项设为 `""` 即可关闭该类播报。默认开启弹幕、进场、关注、点赞和醒目留言，关闭礼物和上舰：

| 模板 | 可用占位符 | 示例 |
| --- | --- | --- |
| `text` | `{author}`、`{content}` | `{author}说，{content}` |
| `enter` | `{author}` | `{author}进入了直播间`（需要下述事件转发适配器） |
| `follow` | `{author}` | `{author}关注了直播间`（需要下述关注事件转发适配器） |
| `like` | `{author}` | `{author}点赞了直播间`（需要下述事件转发适配器） |
| `superChat` | `{author}`、`{content}`、`{price}` | `{author}留言，{content}` |
| `paidGift` / `freeGift` | `{author}`、`{num}`、`{gift}`、`{price}` | `谢谢{author}送的{num}个{gift}` |
| `member` | `{author}`、`{num}`、`{unit}`、`{guard}`、`{price}` | `感谢{author}开通{guard}` |

`price` 单位为元。图片表情、礼物生成的弹幕、跨房镜像弹幕和插件生成的消息会被跳过。语音按收到顺序逐条播放，连续相同的朗读文本只播报一次，中间播报了其他内容后可再次播报；送礼物消息不去重，相同内容也可连续播报。某条播报失败会记录错误并继续下一条。禁用插件、关闭 blivechat 或按 Ctrl+C 时会清空队列，并尝试停止当前语音。

## 配置热加载与用户音色

`default` 放默认声音设置，`users` 放用户专属音色，用户名不再与配置字段共用命名空间。即使用户的名字是 `default` 或 `#default`，也可以作为 `users` 下的普通用户名。

- 按显示名称精确匹配，适用于弹幕、进场、关注、点赞、醒目留言，以及启用的礼物和上舰播报。用户改名后需同步修改配置。
- 音色优先级：`users[用户名].voice` → `default.voice` → 系统默认声音。专属音色只覆盖 `voice`，语速、音量、输出设备使用 `default` 中的设置。
- 启动时加载并校验配置，之后每 300 毫秒检查文件元数据，发生变化时才读取并重新加载，支持编辑器的原子替换保存。普通播报只查询内存，不读取配置文件。
- 默认声音、用户音色、模板、房间筛选和队列设置都支持热加载。模板和筛选影响新收到的消息；每条消息开始播放时选择最新声音，正在播放的消息不会被打断。
- JSON 格式、配置值或音色名称无效时，保留上次有效的整份配置；启动时配置无效会报错退出。运行中删除文件会保留上次有效配置，重新创建后继续加载。
- 删除某个 `users` 项目可恢复默认音色；将 `users` 设为 `{}` 可清空专属音色；将 `default.voice` 设为 `""` 可恢复系统默认声音。

`npm run check` 检查整份配置和所有音色。`--test` 使用 `default` 的声音设置。升级到新配置格式、进场或点赞功能后，需要重启一次使用适配器启动的 blivechat；后续通常只需保存配置，`followWebFallback` 的修改仍需重启宿主。

## 进场、关注与点赞播报

上游 blivechat 插件 SDK 1.x 没有进场、关注和点赞事件，单独添加模板无法接收到这些通知。本项目提供可选的启动适配器，运行时为宿主补上事件转发，无需修改 blivechat 源码。

macOS 中先停止原有的 blivechat，再从本项目运行：

```sh
./bridge/start-blivechat.command
```

默认使用同一父目录下的 `blivechat/.venv/bin/python` 启动宿主。宿主在其他位置时，传入其路径：`./bridge/start-blivechat.command /path/to/blivechat`。保持终端和启用了服务器转发的房间页面运行。

适配器将宿主实际收到的事件转发给语音插件，同类事件的重发会去重：

| 来源 | 事件 | 插件命令 |
| --- | --- | --- |
| 网页版 `INTERACT_WORD_V2`，`msg_type=1` | 进场 | `BLIVECHAT_SAY_ENTER` |
| 开放平台 `LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER` | 进场 | `BLIVECHAT_SAY_ENTER` |
| 网页版 `INTERACT_WORD_V2`，`msg_type=2` | 关注 | `BLIVECHAT_SAY_FOLLOW` |
| 开放平台 `OPEN_LIVEROOM_INTERACT_WORD` | 关注 | `BLIVECHAT_SAY_FOLLOW` |
| 网页版 `LIKE_INFO_V3_CLICK` | 点赞 | `BLIVECHAT_SAY_LIKE` |
| 开放平台 `LIVE_OPEN_PLATFORM_LIKE` | 点赞 | `BLIVECHAT_SAY_LIKE` |

分享和直播间点赞总数更新（`LIKE_INFO_V3_UPDATE`）不会触发播报。设置 `templates.enter: ""` 可关闭进场播报，设置 `templates.follow: ""` 可关闭关注播报，设置 `templates.like: ""` 可关闭点赞播报。每条上游用户点赞通知播报一次；开放平台通知可能聚合短时间内的多次点击。

身份码房间使用旧版 `LIVE_OPEN_PLATFORM_*` 消息流，不能假设它会下发新版 `OPEN_LIVEROOM_INTERACT_WORD`。适配器默认使用宿主已有的 B站 HTTP 会话，为身份码房间额外建立网页版连接，仅处理其中的关注事件，普通弹幕继续使用原连接。进场和点赞直接使用原有开放平台连接，额外网页版连接只转发关注，避免重复进场、点赞和普通弹幕播报。额外连接跟随宿主房间启动和关闭。设置 `followWebFallback: false` 可关闭额外连接。适配器读取相同的用户配置路径；自定义路径时，可用 `BLIVECHAT_SAY_CONFIG=/path/to/config.json ./bridge/start-blivechat.command`，插件也会继承该路径。

**网页版连接仍需通过 B站的实际认证和风控检查；新增点赞播报尚需在重启适配器后进行真实事件验证。** 如连接失败，检查 B站登录状态及宿主日志。适配器不会读取浏览器凭据，也不能生成上游没有推送的事件。新版开放平台关注通知字段参考 [B站官方文档](https://openhome.bilibili.com/doc/4/c7b549c9-d5d6-0331-b510-465ed4107e01)。

`bridge/runtime-status.json` 记录本次启动的进程 ID、接收到的命令名称和次数、网页版关注连接状态及已转发关注、进场、点赞数量（`forwardedFollows`、`forwardedEnters`、`forwardedLikes`），不记录身份码、Cookie 或消息正文。`webListeners` 中 `connected` 表示已收到网页版服务器心跳；`failed:InitError` / `failed:AuthError` 表示初始化或认证失败。宿主日志中的 `Follow event forwarded` / `Enter event forwarded` / `Like event forwarded` 和 `关注事件已接收并加入语音队列` / `进场事件已接收并加入语音队列` / `点赞事件已接收并加入语音队列` 分别确认事件转发和语音插件接收。

适配器测试：`python3 -B -m unittest discover -s bridge -p 'test_*.py'`。

自动中断检查已关闭。停止插件时，通过本地 `voices` 的 `killRunningSay()` 终止当前播报；Swift 只停止本模块的进程，原生 `say` 仍使用 `native-say` 的停止机制。

## 开发与检查

```sh
npm run check
npm test
npm start -- --config ~/.config/blivechat-say/config.json --test "自定义声音试听"
```

插件使用带 `Authorization: Bearer <BLC_TOKEN>` 的 WebSocket 连接 `/api/plugin/websocket`，等待 `BLC_INIT` 后接收消息，每 30 秒发送协议心跳。主程序断开后退出，由 blivechat 管理生命周期。

测试通过内存流中的真实 HTTP/WebSocket 握手和消息帧覆盖认证、初始化、二进制 JSON 帧、心跳、断连、消息解码和播报队列，无需监听端口，也不会播放声音。Windows 后端需要在 Windows 上另行实机验证。

参考：[插件开发文档](https://github.com/xfgryujk/blivechat/wiki/插件系统)、[Python SDK 消息定义](https://github.com/xfgryujk/blivechat/blob/dev/blcsdk/blcsdk/models.py)。
