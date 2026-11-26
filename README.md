# blivechat-say

使用 [LitoMove Live Voices](https://github.com/litomore-live/voices)（封装 [native-say](https://github.com/LitoMore/native-say) 与 Siri 音色）为 [blivechat](https://github.com/xfgryujk/blivechat) 提供系统原生语音播报。该项目是需要单独克隆的独立仓库，运行时以 `voices` 为目录名放在本项目的同级目录。macOS 调用内置 `say` 或 Swift / AVSpeechSynthesizer，Windows 调用 PowerShell / SpeechSynthesizer，无需云端 TTS 服务。

## 环境

- Node.js 24 或更新版本（LitoMove Live Voices 的要求）。
- macOS 或 Windows，已安装想使用的系统声音。
- 支持插件系统的 blivechat；当前按插件 SDK 1.x 协议实现。
- 插件与音频输出运行在 **blivechat 后端所在的电脑**。Docker、远程服务器不会直接在你的 Mac 上发声。

## 安装与试听

先将两个仓库克隆到同一父目录：

```sh
git clone https://github.com/litomore-live/voices.git
git clone https://github.com/litomore-live/blivechat-say.git
```

目录应为：

```text
同一父目录/
├── voices/
└── blivechat-say/
```

如果已有 `blivechat-say`，只需在它的父目录克隆 LitoMove Live Voices。然后在 `blivechat-say` 目录运行：

```sh
npm ci --prefix ../voices
npm ci
npm run config:init
npm run voices
npm start -- --test "你好，语音播报测试。"
```

当前代码直接从 `../voices/src/index.js` 加载语音模块，两个仓库都需要安装依赖；macOS 使用 Siri 声音还需要 Xcode Command Line Tools 提供的 Swift。无需发布到 npm 或运行 `npm link`。

`npm run config:init` 会创建 `~/.config/blivechat-say/config.json`；Windows 使用用户主目录下的 `.config\blivechat-say\config.json`。设置了绝对路径的 `XDG_CONFIG_HOME` 时，使用 `$XDG_CONFIG_HOME/blivechat-say/config.json`。`npm run voices` 会列出本机安装的声音；将声音的完整 `name` 或 `identifier` 填入配置的 `default.voice`，空字符串使用系统默认声音。macOS 中文声音可在系统设置的辅助功能相关语音设置中下载；以本机列出的名字为准。

## 接入 blivechat

macOS 开发环境下，如果本项目与 blivechat 位于同一父目录，可以直接运行：

```sh
npm run install:plugin
```

脚本在 blivechat 插件目录创建启用状态的 `plugin.json`，使用当前 Node 和本项目入口的绝对路径。项目保留在原位置，不需要复制依赖。自定义宿主位置可用 `npm run install:plugin -- --blivechat /path/to/blivechat`；加 `--dry-run` 可预览写入内容。安装后重启 blivechat 一次。

手动安装时，将整个项目放在 `blivechat/data/plugins/blivechat-say/` 下，同时将 LitoMove Live Voices 放在 `blivechat/data/plugins/voices/` 下，并分别在两个项目目录运行 `npm ci`。目录应为：

```text
blivechat/data/plugins/
├── voices/
│   ├── package.json
│   ├── src/
│   └── node_modules/
└── blivechat-say/
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
  "ignoredEnterUsers": ["小明", "小红"],
  "events": {
    "like": false,
    "paidGift": true
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
| `ignoredEnterUsers` | `[]` | 按完整显示名精确匹配，只跳过这些用户的进场播报。保存后对新收到的进场事件生效 |
| `maxQueueSize` | `5` | 等待队列长度，不含当前播报；满时丢弃最旧的待播消息 |
| `maxAgeSeconds` | `30` | 等待超过此秒数的消息不再播报 |
| `maxLength` | `120` | 每条完整播报的最大字符数，超出截断并加省略号 |
| `roomIds` | `[]` | 空数组播报所有房间；例如 `[123456]` 只播报该房间 |
| `followWebFallback` | `true` | 为身份码房间额外建立网页版连接，仅用于关注播报；修改后需重启宿主 |
| `events` | 见下文 | 按事件开启或关闭播报，值为 `true` 或 `false` |

默认开启弹幕（`text`）、进场（`enter`）、关注（`follow`）、点赞（`like`）和醒目留言（`superChat`）。付费礼物（`paidGift`）、免费礼物（`freeGift`）和上舰（`member`）默认关闭。旧配置的 `templates` 仍可直接加载：空字符串对应关闭，非空字符串对应开启，播报文案统一使用内置版本。同一事件同时配置时，以 `events` 为准。

图片表情、礼物生成的弹幕、跨房镜像弹幕和插件生成的消息会被跳过。语音按收到顺序逐条播放，连续相同的朗读文本只播报一次，中间播报了其他内容后可再次播报；送礼物消息不去重，相同内容也可连续播报。某条播报失败会记录错误并继续下一条。禁用插件、关闭 blivechat 或按 Ctrl+C 时会清空队列，并尝试停止当前语音。

## 配置热加载与用户音色

`default` 放默认声音设置，`users` 放用户专属音色，用户名不再与配置字段共用命名空间。即使用户的名字是 `default` 或 `#default`，也可以作为 `users` 下的普通用户名。

- 按显示名称精确匹配，适用于弹幕、进场、关注、点赞、醒目留言，以及启用的礼物和上舰播报。用户改名后需同步修改配置。
- 先取 `users[用户名].voice`，再取 `default.voice`。两者都未指定时使用系统默认声音。插件在启动和配置重载时缓存本机音色及语言代码，配置里只需填写音色名或 identifier。
- 弹幕和醒目留言分别识别用户名和正文，再选整条播报的文案和音色。两边都是英文时用英文；英文与中文、日文或韩文混用时，选对应的中文、日文或韩文。例如 `Alice` 发“你好”和“小明”发 `Hello` 都用中文，`Alice` 发 `Hello` 用英文。用户名和正文分别属于中、日、韩中的两种语言时，先用名字对应的音色读名字，再用正文对应的音色读引导语和正文。例如“小明”发日文时，“小明”用中文读，后面的“さんが言いました”和留言用日文读。
- 进场、关注、点赞、礼物和上舰按用户名选语言。英文用户名进场时用中文音色读“用户名进入了直播间”，例如“Alice进入了直播间”。即使音色配置为空，这类进场播报也会优先选本机中文音色。只有数字、表情或标点的留言按用户名处理。纯拉丁字母或带数字的拉丁字母用户名按英文处理。
- 用户名和正文中的汉字与拉丁字母混写时按中文处理，例如 `一果Old`。混写中带有日文假名或韩文字母时，分别按日文或韩文处理。数字、空格、标点和表情不影响这项判断。
- Franc、LanguageDetect、TinyLD 在本机识别语言，短文本也会参考文字和常见英文问候语。只要用户名或正文有一项识别为四种语言之外的语言，整条播报就使用中文文案和全局 `default.voice`，即使该用户配置了专属音色。全局音色为空时使用系统默认声音。某一项没有识别结果时按另一项判断。`--test` 试听直接按输入文本选音色。
- 普通话、台湾口音和粤语音色都按中文匹配。比如选了台湾口音的 Meijia 或粤语的 Sinji，识别为中文的简体、繁体消息都会用所选音色朗读。
- 语言相同就使用指定音色。语言不同则优先选地区完全匹配的音色，其次选同语言音色。候选音色按 Premium → Enhanced → Standard 排序，同等级优先 Siri，再优先编号较大的 Siri。无法识别或没有合适音色时使用原先指定的音色。语速、音量和输出设备都取自 `default`。
- 启动时加载并校验配置，之后每 300 毫秒检查文件元数据，发生变化时才读取并重新加载，支持编辑器的原子替换保存。普通播报只查询内存，不读取配置文件。
- 默认声音、用户音色、事件开关、房间筛选和队列设置都支持热加载。开关和筛选影响新收到的消息；每条消息开始播放时选择最新声音，正在播放的消息不会被打断。
- JSON 格式、配置值或音色名称无效时，保留上次有效的整份配置；启动时配置无效会报错退出。运行中删除文件会保留上次有效配置，重新创建后继续加载。
- 删除某个 `users` 项目可恢复默认音色；将 `users` 设为 `{}` 可清空专属音色；将 `default.voice` 设为 `""` 可恢复系统默认声音。

`npm run check` 检查整份配置和所有音色。`--test` 使用 `default` 的声音设置。升级四语播报后，在插件管理中关闭「原生语音播报」，等至少 3 秒再启用即可。后续调整配置只需保存文件，`followWebFallback` 的修改仍需重启宿主。

## 进场、关注与点赞播报

上游 blivechat 插件 SDK 1.x 没有进场、关注和点赞事件。本项目提供可选的启动适配器，运行时为宿主补上事件转发，无需修改 blivechat 源码。

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

分享和直播间点赞总数更新（`LIKE_INFO_V3_UPDATE`）不会触发播报。在 `events` 中将 `enter`、`follow` 或 `like` 设为 `false`，即可分别关闭这些播报。每条上游用户点赞通知播报一次；开放平台通知可能聚合短时间内的多次点击。

身份码房间使用旧版 `LIVE_OPEN_PLATFORM_*` 消息流，不能假设它会下发新版 `OPEN_LIVEROOM_INTERACT_WORD`。适配器默认使用宿主已有的 B站 HTTP 会话，为身份码房间额外建立网页版连接，仅处理其中的关注事件，普通弹幕继续使用原连接。进场和点赞直接使用原有开放平台连接，额外网页版连接只转发关注，避免重复进场、点赞和普通弹幕播报。额外连接跟随宿主房间启动和关闭。设置 `followWebFallback: false` 可关闭额外连接。适配器读取相同的用户配置路径；自定义路径时，可用 `BLIVECHAT_SAY_CONFIG=/path/to/config.json ./bridge/start-blivechat.command`，插件也会继承该路径。

**网页版连接仍需通过 B站的实际认证和风控检查；新增点赞播报尚需在重启适配器后进行真实事件验证。** 如连接失败，检查 B站登录状态及宿主日志。适配器不会读取浏览器凭据，也不能生成上游没有推送的事件。新版开放平台关注通知字段参考 [B站官方文档](https://openhome.bilibili.com/doc/4/c7b549c9-d5d6-0331-b510-465ed4107e01)。

`bridge/runtime-status.json` 记录本次启动的进程 ID、接收到的命令名称和次数、网页版关注连接状态及已转发关注、进场、点赞数量（`forwardedFollows`、`forwardedEnters`、`forwardedLikes`），不记录身份码、Cookie 或消息正文。`webListeners` 中 `connected` 表示已收到网页版服务器心跳；`failed:InitError` / `failed:AuthError` 表示初始化或认证失败。宿主日志中的 `Follow event forwarded` / `Enter event forwarded` / `Like event forwarded` 和 `关注事件已接收并加入语音队列` / `进场事件已接收并加入语音队列` / `点赞事件已接收并加入语音队列` 分别确认事件转发和语音插件接收。

适配器测试：`python3 -B -m unittest discover -s bridge -p 'test_*.py'`。

自动中断检查已关闭。停止插件时，通过本地 LitoMove Live Voices 的 `killRunningSay()` 终止当前播报；Swift 只停止本模块的进程，原生 `say` 仍使用 `native-say` 的停止机制。

## 开发与检查

```sh
npm run check
npm test
npm start -- --config ~/.config/blivechat-say/config.json --test "自定义声音试听"
```

插件使用带 `Authorization: Bearer <BLC_TOKEN>` 的 WebSocket 连接 `/api/plugin/websocket`，等待 `BLC_INIT` 后接收消息，每 30 秒发送协议心跳。主程序断开后退出，由 blivechat 管理生命周期。

测试通过内存流中的真实 HTTP/WebSocket 握手和消息帧覆盖认证、初始化、二进制 JSON 帧、心跳、断连、消息解码和播报队列，无需监听端口，也不会播放声音。Windows 后端需要在 Windows 上另行实机验证。

参考：[插件开发文档](https://github.com/xfgryujk/blivechat/wiki/插件系统)、[Python SDK 消息定义](https://github.com/xfgryujk/blivechat/blob/dev/blcsdk/blcsdk/models.py)。
