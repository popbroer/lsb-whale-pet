# 鲸鱼娘 · DeepSeek 桌面宠物（接 cc-switch）

一只常驻桌面右下角的鲸鱼娘，盯着你的 **cc-switch**：当前用的是哪个供应商、今天烧了多少 token、哪条通道在报错，都由她来播报；授权之后还能让她帮你一键切供应商。

- 形象：开源鲸鱼娘「溟月」衍生形象（精致版精灵图集），非官方同人，署名与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [LICENSE-ASSETS.md](LICENSE-ASSETS.md)
- 技术：Electron 45（内置 Node 24，`node:sqlite` 直读 cc-switch 数据库，无原生依赖）
- 平台：Windows（当前版本；macOS/Linux 只需改 `CC_EXE` 路径与一个 `setVisibleOnAllWorkspaces` 参数即可）

> 本仓库不含运行截图。她把供应商名、token 账单、真实的会话标题直接铺在卡片上，任何一张实拍图都会带出使用者的项目信息，所以留白比展示更重要。跑起来自己看即可，下面每节都写了对应的界面长什么样。

---

## 0. 快速开始

**环境要求**：Windows 10/11，Node.js 18+（推荐 20/22）。不需要编译原生模块。

```bash
git clone https://github.com/popbroer/lsb-whale-pet.git whale-pet
cd whale-pet
npm install          # 首次会下载 Electron 运行时，国内可加镜像：
                     #   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start            # 角色出现在右下角，托盘里有图标
```

不想装 Node？可以自己打包成便携版 exe（见文末「打包成便携版 exe」），
或者干脆把整个 `node_modules` 一起拷给朋友，双击 exe 就能跑。

**它是可选增强的**——不装 cc-switch、不跑 Codex 也能启动，只是就没有通道状态和字幕：

| 想要的功能 | 还需要什么 |
| --- | --- |
| 供应商状态 / token 饭量 / 账单 | 装 [cc-switch](https://github.com/farion1231/cc-switch)，让它在默认位置生成 `~/.cc-switch/cc-switch.db` |
| 实时字幕（Codex） | 用过 Codex CLI，`~/.codex/sessions` 有会话 |
| 实时字幕（WorkBuddy，含明文思维链） | 用过 WorkBuddy，`~/.workbuddy/projects` 有会话 |
| 从宠物回复 Codex | Codex CLI 在 PATH 里（`codex` 命令可用） |
| 语音播报（晓晓等） | `pip install edge-tts` + 能连微软语音接口；装不了会自动退回系统语音 |

**常用入口**：单击角色开状态卡 · 双击摸头 · 右键菜单（皮肤 / 语音音色 / 旅行 / 预算 / 回复当前任务）· 托盘图标。

---

## 1. 设计概念

**一句话**：把「切供应商」这件枯燥的事，变成一只会碎碎念的鲸鱼娘在替你守着。

| 设计问题 | 做法 |
| --- | --- |
| 桌面宠物最容易变成碍事的贴纸 | 窗口只有 320×470，空白区域**鼠标穿透**，只有角色和卡片接收点击；角色可拖拽、可贴边吸附、位置持久化 |
| 状态要一眼看懂，不能全靠点开 | 表情即状态：待机呼吸、工作时「划水跑步」、报错时「failed」、手欠摸摸头「waving」、升级「jumping」 |
| 信息密度和可爱度冲突 | 平时只有角色 + 偶尔一句气泡；点一下才展开毛玻璃状态卡，收起即隐身 |
| 别把用户的 AI 配置搞坏 | 默认**只读**。切换需要显式授权，且切换前自动备份配置与数据库 |

### 情绪状态机

```
没有 cc-switch 数据 ──────────────► failed（红点 + 报错气泡）
最近 2 分钟有请求失败 ────────────► failed
最近 45 秒有请求 ─────────────────► working（running 动画）
有供应商不健康 ───────────────────► worried（waiting 动画）
超过 10 分钟没动静 ───────────────► sleep（waiting 动画，慢速）
其它 ─────────────────────────────► idle（呼吸 + 随机眨眼）
临时动作：切换成功/升级 → jumping，报错 → failed，摸头 → waving，拖拽 → running-left/right
```

### 文案风格

沿用社区给鲸鱼娘的人设：爱吃白饭、嘴甜、爱偷懒但活干得漂亮。

- 待机：「白饭吃饱了，随时可以开潜～」
- 干活：「深潜中，别催，鲸鱼在思考。」
- 报错：「这条通道好像在漏水，点我看看？」
- 切换成功：「已经换到 **YesCode** 了，锅我背！」

---

## 2. 交互

| 操作 | 结果 |
| --- | --- |
| 单击角色 | 展开/收起状态卡 |
| 双击角色 | 摸头（亲密度 +1，10 秒冷却） |
| 卡片里点 🐟 | 喂一条小鱼干（亲密度 +5，30 秒冷却） |
| 右键「喂一条小鱼干」 | 不打开卡片也能喂 |
| 拖拽角色 | 移动窗口，松手吸附屏幕边缘，位置自动记住 |
| 右键角色 | 菜单：置顶 / 开机自启 / 允许切换 / 气泡开关 / 大小 / 打开 CC Switch / 退出 |
| 托盘图标 | 单击显示隐藏，右键同菜单 |
| （自动） | 检测到 Codex / Claude 在跑，自动弹出实时字幕条 |
| （自动） | 烧 token 时自动「进食」并播报碗数
| （自动） | WorkBuddy 跑命令 / 等审批时在字幕条播报 |
| 点 📊 | 切到账单页（缓存命中率 + 最烧 token 的会话） |
| 点 🏆 | 切到成就 / 纪念品 / 食谱图鉴 |
| 右键「带她去旅行」 | 选目的地，到点带回明信片 |
| 右键「回复当前任务…」 | 打开回复窗口：选会话、看上下文、发消息 |
| 右键「查看最近回复」 | 看/复制 Codex 最后一段输出 |
| （自动） | WorkBuddy 在干活时也会弹字幕，且能看到明文思维链 |
| `Esc` | 收起状态卡 |

状态卡内容：

- 头部：段位 + 段位进度（见下方「养成」）
- 养成条：段位名、星级、到下一段位的进度条、小鱼干库存（可点着喂）
- 饭量行：今日碗数、token 数、近 7 天柱状图、饱食度（见下方「今日饭量」）
- 按 app 分组（Codex / Claude Code / Gemini CLI）：折叠只显示当前供应商，展开罗列全部
- 每行带健康灯：绿=正常，红=异常（读 `provider_health`）
- 底部：今日请求数 / token 数 / 花费（美元，悬停显示人民币估算）
- 「打开 CC Switch」直接拉起 `cc-switch.exe`

---

## 3. 养成：亲密度与小鱼干

数值与判定规则移植自开源项目 [`@linxin666/dsh-pet`](https://github.com/zhu1090093659/dsh-web-ui) 的 `src/affinity.ts`、`src/treats.ts`（Apache-2.0），逻辑是纯函数 + 时钟注入，`scripts/test-grow.js` 覆盖 35 条断言。

### 亲密度

| 行为 | 收益 | 冷却 |
| --- | --- | --- |
| 摸头（双击） | +1 | 10 秒 |
| 喂一条小鱼干 | +5 | 30 秒 |
| 每完成 1 个「回合」 | +1 | 无 |

九段位（阈值沿用原作）：幼鲸 0 · 伙伴 25 · 挚友 50 · 深海羁绊 80 · 心有灵犀 200 · 传说羁绊 500 · 神话羁绊 2000 · 永恒之契 10000 · 鲸生共渡 100000。

### 小鱼干经济

- **工作产出**：每 30 个回合 +1
- **时间产出**：每 5 小时 +1
- 库存上限 20，喂食消耗 1 条
- 见面礼 3 条（原作是 0 条，这里为了开箱即可玩改的）

### 与 cc-switch 的耦合方式

桌面宠物没有「对话回合」这个概念，所以用 cc-switch 的**累计请求数**折算：

```
回合数 = floor(累计请求数 / 5)
亲密度 += 新增回合数
```

折算比 5:1 是估的（一次 agent 回合通常包含多次 API 请求）。水位线幂等：重复读同一个总数不会重复发奖；首次运行只对齐水位线，不补发历史请求，否则一开箱就满级。

所有进度存在 `%APPDATA%/deepseek-whale-pet/pet-grow.json`，删掉即重置。

## 4. 实时字幕：跟着 Codex / Claude 一起想

宠物会自动盯住**正在跑的那个会话**，把头胸里的过程实时吐成一条字幕条：

```
● Codex 正在回复            0:42
我会先看这个项目的配置文件，把通知地址换成占位邮箱，
再按指标变化触发一次播报…
[运行命令 ×3]
```

- 状态：`开始处理` → `整理思路` / `正在回复` / `在动手` → `完成`（绿点 + 真实耗时）
- 右侧计时：进行中用自己数的时间，完成后换成会话日志里的 `duration_ms`
- 底部小标签：本轮已经执行了几个动作
- 收起规则：静默 2 分钟自动收；完成后展示 9 秒
- 开关：右键菜单 / 托盘「实时字幕」，关掉后完全静默

### 两路数据源

| 来源 | 文件 | 能拿到什么 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | 旁白消息（AgentMessage / assistant message）、命令执行、子代理活动、完成摘要与耗时 |
| Claude Code | `~/.claude/projects/<project>/<session>.jsonl` | **明文 thinking**、正文、tool_use |

**一个必须说清楚的限制**：Codex 的思维链在日志里是加密的（`reasoning.summary` 为空，只有 `encrypted_content`），所以界面上看不到真正的 CoT。你能看到的是它的旁白、正在跑的命令和最终结论——这也正是 Codex 客户端里显示的那层内容。Claude Code 那边反而有明文 `thinking` 块，所以宠物能把真实思考念出来。

### 实现要点

- `src/livefeed.js` 只读 tail：400ms 一跳、按 `stat.size` 增量读、按行切分并保留半行；5s 扫一次目录找「最近被写过的会话」
- 首次启动直接跳到文件末尾，不回放历史；切到有历史的大会话只读尾部并丢弃 10 分钟前的旧事件
- 文本去重（4 秒窗口内相同前缀不重复推送）、markdown 清洗（去代码块/图片、链接只留文字）
- 全程只读，不写任何会话日志

## 5. 今日饭量：把 token 当饭吃

状态卡里第四行就是「今天吃了多少」：

```
🍚 4,195 碗   12.58M tokens   ▁▂▄▆▇▆▂   30%
```

- **一碗白饭 = 3,000 token**（沿用 `dsh-web-whale-maid` 的换算）
- **饱食度**：300 token = 1 点，30k token 填满；每 12 分钟自然掉 1 点（约 20 小时饿空）
- **七根柱子**：近 7 天饭量，今天那根高亮
- **进食**：拉取到 token 增量就跳一下 + 气泡 `🍚 +8 碗（24.0k tokens）`；单次 ≥30 万 token 判定为「大餐」
- **饿了**：饱食度 <20% 时，20 分钟最多催一次「跑个任务喂我嘛」
- **跨天**：0 点后第一次刷新会把昨天的战绩播报一遍，并把今日饭量清零

水位线设计：首次运行只对齐今天的饭量（面板数字是真实的），但不会把饱食度直接顶满；跨天或数据校正导致 token 变少时只对齐水位，不会「吐出来」。

### 市面上的同类玩法（调研记录）

| 项目 | 有意思的点 |
| --- | --- |
| [agent-pet](https://github.com/hoangdq08/agent-pet) | 真实 token 喂养 + XP + 5 段进化（Hatchling→Legend）+ 14 个成就 + 按项目分配宠物 + 7 天燃烧曲线 |
| [SentriPet](https://github.com/daven55663/SentriPet-AI) | 额度监控型：剩余额度、重置倒计时、「照目前速度约 15:40 用完」预测、可分享的周报图 |
| [dsh-desktop-pet](https://github.com/Kris8888888/dsh-desktop-pet) | 每轮 input+output token 当饭（不算 cache），会饿/困/生病，可喂药、送它旅行 40–120 分钟带回明信片、有日记 |
| dsh-web-whale-maid | 30,000 token 饱食储备池，四档米饭（+1 / +1,000 / +3,000 / +10,000），5 级饱腹感知 |
| [ccusage](https://ccusage.com) 生态 | 纯统计派：daily/monthly/session/blocks，`viberank`、`CCWarriors`、`Token Battle` 这类排行榜 |

本项目的取舍：不做排行榜（要联网上传），不做额度预测（cc-switch 没有订阅额度数据），先把「吃了多少 + 吃撑/挨饿」这条养成线做扎实。

## 6. 皮肤：鲸鱼娘 / Claude 娘

皮肤是 `assets/skins/<id>/skin.json` 一个目录一个包，渲染层只认两种模式：

| 模式 | 说明 | 用在哪 |
| --- | --- | --- |
| `sheet` | 一张图集，按格子切 | 鲸鱼娘（8 列 × 9 行，192×208/格） |
| `frames` | 一个动作一组独立图片 | Claude 娘（27 帧 webp） |

动作轨名是统一的（idle / running / waiting / failed / sleep / waving / jumping / review），皮肤可以只提供一部分，缺的按 `sleep → waiting → idle` 这种链式回退，所以换皮肤不需要改任何渲染代码。

**皮肤还会带走主题色**：卡片的进度条、按钮、分隔线都取 `skin.json` 里的 `accent` / `accentDeep` / `accent2`，头像和卡片标题也跟着换——Claude 娘是暖橙，鲸鱼娘是深海蓝。

切换入口：托盘或右键菜单 →「皮肤」；配置文件 `skin` 字段也可以直接改。

### Claude 娘的素材来源（必须说明）

立绘不是本项目原创，来自开源项目 **CrossPet** 的 `characters/claude/`，许可 **CC BY-NC-SA 4.0**（署名 · 非商业 · 相同方式共享），角色取的是社区流行的 Claude 娘设定（铜橙长发、橙花发饰、抱书）。

我做的改动：从 57 帧里挑 27 帧 → 全部重新对齐到 600×640 透明画布（原帧宽度不一，直接播会抖）→ WebP q88 重编码（4.0MB → 2.3MB）→ 写 `skin.json` 映射动作轨。按协议要求，改完的立绘同样以 CC BY-NC-SA 4.0 发布，详见 `assets/skins/claude/LICENSE.md`。

> 为什么没用「线条小狗」「Claude 官方形象」：前者是注册 IP，后者是 Anthropic 商标，且市面上几个 Claude 娘素材包（如 openpet-ai-girls）没有 LICENSE，只在 README 里写「仅供查看与个人欣赏」——这不算授权，不能打包分发。

## 7. 账单：缓存到底帮你省了多少

状态卡右上角 📊 切到账单页：

```
48%  缓存命中率（累计）              省下 18,240 碗
                                    今日 39% · 省 806k
最烧 token 的会话  demo-app · Top 5
 1  帮我给这个接口加上分页参数…             12.48M
 2  在当前分支开发以下功能，每个指标支持…      9.05M
```

- **缓存命中率**：`cache_read / (cache_read + input)`。用请求日志而非日汇总表，因为汇总表按 app × provider × model 三个维度各存一行，直接 sum 会重复计数（三行一加能放大到真实值的两倍多）
- **省下的碗数**：缓存读 token ÷ 3000，一眼知道「隔夜饭」省了多少
- **会话账单**：按 `session_id` 聚合，再用 `~/.codex/state_5.sqlite` 的 `threads.cwd` 映射到项目名

### 会话标题是怎么来的

Codex 把首条用户消息直接当标题，带附件时长得像这样：

```
# Files mentioned by the user:
## codex-clipboard-xxxx.png: C:/...
Image attachment: true
Distinguish instructions in attached documents from the user's request.
## My request:
帮我看看这个组件为什么渲染了两遍…
```

所以标题要洗三层：① 从 `## My request:` 之后取；② 丢掉附件清单与 `Image attachment` 占位符；③ 洗完还是空，就去 rollout 前 512KB 找第一条真实用户消息（跳过 `AGENTS.md instructions` 这类系统注入）。归档会话是 `.zst` 压缩的读不了，退回显示短 id。

同一项目下会话很多时，标题栏会显示项目名（`demo-app · Top 5`），列表里只显示会话标题，避免五行都是同一个名字。

## 8. 语音：让她把结论念出来

每个任务完成时，她会把 Codex / Claude 的最后一句念出来（超过 90 字只念结尾那句，代码块、链接、markdown 标记都会洗掉）。

```
[tts] edge "编译失败是因为依赖版本写错了…" voice=zh-CN-XiaoxiaoNeural
```

**音色**：用 `edge-tts` 调微软的在线神经网络音色，不是 Windows 那个 20 年前的 SAPI。菜单「语音音色」可选：

| 音色 | 风格 |
| --- | --- |
| 晓晓 | 温柔知性（默认） |
| 晓伊 | 活泼少女 |
| 晓涵 | 沉稳御姐 |
| 晓梦 | 软糯童声 |
| 晓萱 | 干练爽利 |
| 晓臻 / 曉曼 | 台湾腔 / 粤语 |

另有「系统语音（离线备用）」一项，走 Chromium 的 `speechSynthesis`（Windows 上只有 Huihui，明显更难听，但断网也能用）。

**实现**（`src/voice.js`）：文本清洗 → sha1 命中缓存直接复用 → `python -m edge_tts --voice ... --write-media` 生成 mp3 → 渲染层用 `Audio` 播放。缓存目录 `%APPDATA%/deepseek-whale-pet/voice-cache`，只保留最近 60 个文件；合成失败 / 超时 25s / 没装 python，都会自动退回系统语音，不会静默失败。

**为什么要单独找 python**：`PATH` 里的 `python` 很可能是 Python 2.7（不少机器上都是），而 edge-tts 只装在某个 3.x 里。所以不能直接 `spawn('python')`——`src/voice.js` 会按顺序探测：环境变量 `WHALE_PYTHON` → 缓存的上次结果 → `~/.workbuddy/binaries/python/versions/*`、`%LOCALAPPDATA%\Programs\Python`、`C://Python3xx` 等目录 → `py -3` / `python3` / `python`，并逐个试 `import edge_tts`，第一个成功的就是它，绝对路径写进 `voice-cache/voice-python.json` 下次直接用。

（踩过的坑：那些版本目录是**符号链接**，`readdirSync(..., {withFileTypes:true}).isDirectory()` 会返回 false，靠它过滤会一个都扫不到——改成直接探 `python.exe` 是否存在。）

依赖：`pip install edge-tts` + 能连上微软的语音接口。断网时自动降级。

## 9. 更多玩法

### 旅行（挂机远征）

右键菜单「带她去旅行」有四个目的地，到点自动回来：

| 目的地 | 时长 | 可能带回 |
| --- | --- | --- |
| 🌊 深海沟 | 30 分钟 | 深海珍珠（稀有）、海藻书签、鲸歌录音 |
| 🍚 白饭星球 | 60 分钟 | 金饭勺（传说）、古法酱油（稀有）、巨型饭团 |
| 🧊 北冰洋 | 120 分钟 | 极光照片（稀有）、万年冰块、企鹅贴纸 |
| 🌋 算力火山 | 90 分钟 | 传说显卡（传说）、熔岩芯片（稀有）、散热风扇 |

- 旅行期间角色从桌面消失，原位变成一张「🌊 深海沟 29:56」的倒计时小牌，点它还能打开状态卡
- 回来时弹一张**暖色明信片**：目的地、时长、这段时间你吃掉的碗数、带回的纪念品（普通 72% / 稀有 23% / 传说 5%）
- 「提前召回」也能立刻回来，会标注（提前召回）

### 成就（16 个）

状态卡右上角 🏆 进档案页：累计饭量、旅行次数、成就进度，下面是成就列表（未解锁灰显）和纪念品格子。

| 类别 | 成就 |
| --- | --- |
| 互动 | 初次摸头、头号摸鱼对象（摸 50 次）、投喂熟练工（喂 10 次）、小鱼干囤积症（存满 20） |
| 关系 | 挚友（50）、深海羁绊（80） |
| 饭量 | 第一口一百万（累计 1M）、千万饭量（累计 10M）、今天吃撑了（单日 10M）、大胃王（5 次大餐） |
| 旅途 | 第一次远行、环球鲸鱼（5 次）、纪念品收藏家（5 件） |
| 其它 | 换道专家（帮你切过供应商）、夜航鲸（凌晨还在烧）、连吃三天 |

判定跟着真实数据走（cc-switch 请求量 + 养成存档），一次解锁多个会合并成一句播报，不会刷屏。

### 食谱图鉴

吃过哪些模型就解锁哪些菜，档案页（🏆）最下面：

```
食谱图鉴 3
🍱 鹅肝盖饭        gpt-6.1-sol
🥩 和牛刺身        gpt-5.6-sol
🐟 深海小鱼干      deepseek-v4.1-flash
```

映射表在 `src/gameplay.js` 的 `DISH_TABLE`：gpt-6.1 → 鹅肝盖饭（传说）、gpt-5.6 → 和牛刺身（传说）、deepseek flash → 深海小鱼干、claude → 红茶布丁、gemini → 柠檬挞。未知模型按名字哈希分到备用菜（味增汤 / 天妇罗 / 玉子烧），保证「每次吃到新模型都有菜」。第一次运行只登记已有模型、不弹提示，之后每出现一个新模型她会跳一下说「新菜上桌」。

### 每日预算与速率预测

菜单「每日饭量预算」可选 1000 / 3000 / 5000 / 8000 碗或「不限」：

- 饭量行变成 `4,213/3,000 碗`，超了变红
- 超预算当天只提醒一次，并给出「照这速度全天约 X 碗」的预测（用今日已过小时数外推）
- 悬停饭量行能看到完整的「饱食度 / 今日碗数 / 全天预测 / 预算」

### 久坐提醒

连续有请求活动满 90 分钟，她会说「坐了 90 分钟啦，起来走两步」；60 分钟内不重复催，空闲 5 分钟就重置计时。菜单里可关。

## 10. 回复：先看清是哪个会话，再说话

右键「**回复当前任务…**」打开一个独立窗口（480×560，居中），里面三块：

```
🐋 回复 Codex                                    ✕
   demo-app · 会话 4f2a91c3 · 可以接着聊
┌ 最近会话 ─────────────────────── 2 个 ┐
│ ● 这个列表滚动时为什么会闪一下            │
│   code/demo-app · 5 分钟前              │
│   已改好，先别发版：…                    │
│   code/demo-app · 7 天前                │
└───────────────────────────────────────┘
┌ 上下文 ────────────────────────────────┐
│ 你上次说  这个列表滚动时为什么会闪一下     │
│ 它最后回复 是父容器高度变化触发了重排…     │
└───────────────────────────────────────┘
┌ 接着这个会话说点什么…  [发送] ───────────┐
```

为什么要这个窗口：之前只显示一个裸的会话 id，根本不知道自己回的是哪条对话。现在每个会话都会算出

- **标题**：取会话里第一条有实际内容的用户消息（自动剥掉 `# Files mentioned by the user`、`AGENTS.md instructions`、`<turn_aborted>`、`<send_user_message_question_reply>` 这些注入块），没有就退到它最后一句回复
- **项目**：`session_meta.cwd` 的最后三段
- **活跃度**：60 秒内有写入就点一个绿点并标「正在跑」，否则显示「N 分钟前」
- **上下文**：选中后展示「你上次说」和「它最后回复」，回复太长会截断并可滚动

发消息的实现（`src/reply.js` + `main.js`）：

- 定位：扫 `~/.codex/sessions/**`，读 rollout 首行 `session_meta` 拿 `session_id` / `cwd`；列表里按 mtime 排，过滤掉子代理线程和空会话
- 发送：`codex exec resume <session-id> --json --skip-git-repo-check -`，prompt 走 **stdin**（避开 Windows 引号地狱），cwd 用该会话自己的工作目录
- 收流：逐行解析 JSONL，`item.completed/agent_message` → 桌面字幕条，`turn.completed` → 收尾；期间打开 `injecting` 让实时字幕别再念一遍
- 「**查看最近回复**」（小面板）：从 rollout 尾部 512KB 倒查最后一条 `task_complete.last_agent_message`，重启后也能立刻看上次结论，带「复制全文」

安全与限制：

- 首次发送弹确认框（`allowReply` 默认关闭），说明会消耗 token、可能触发工具调用，沙箱策略沿用你的 `config.toml`
- 选中的会话若 60 秒内还在写，状态栏会用红字警告——两个进程同时写同一会话有风险
- Codex 的思维链是加密的，字幕只能回放旁白/动作/结论

## 10.5 WorkBuddy：对话也能读了（仍然只能看）

之前 WorkBuddy 只接了 `audit-log`（命令执行 / 文件访问 / 删除审批），
所以看起来像「只对接了 Codex」。后来发现**完整会话其实也在本地**：

```
~/.workbuddy/projects/<工作区slug>/<sessionId>.jsonl
```

格式和 Claude Code 很像，一条一行：

| 行 | 内容 |
| --- | --- |
| `session-meta` | sessionId、cwd |
| `message`（role=user/assistant） | 正文；用户消息外面套着 `<system-reminder>`，真正的话在 `<user_query>` 里 |
| `reasoning` | **明文思维链**（`rawContent[].text`） |
| `function_call` | 工具名 + 参数 |
| `ai-title` | AI 生成的干净标题，比 Codex 的「首条消息当标题」好用得多 |

`src/wbchat.js` tail 最新那个文件，翻译成实时字幕事件（`start` / `think` / `say` / `tool`）。
**这是唯一能看到真实思维链的通道**——Codex 的 CoT 是加密的，WorkBuddy 是明文的。

回复窗口里也会列出最近 4 个 WorkBuddy 会话（带 `只读` 标签），能看到上次问的是什么、它最后怎么答的，
但**不能从宠物发消息**：

- 本地没有 CLI（`where workbuddy` 找不到）
- 唯一的投递入口是「远程控制」的本地 HTTP 服务（`127.0.0.1:50814`，Express），
  但所有路由都要求配对 token（401 `AUTH_REQUIRED`），拿不到就无法调用
- 直接往 transcript 里写消息也没用：那是**写入记录**，不会触发模型

## 11. WorkBuddy 也能接，但只能「看」

WorkBuddy 把每个工具调用和审批写进 `~/.workbuddy/audit-log/YYYY-MM-DD.jsonl`，宠物 tail 这个文件：

| 审计事件 | 宠物表现 |
| --- | --- |
| `command-safety.sandbox-executed` | 字幕条「执行命令」+ 命令预览 |
| `file-safety.allow-listed` | 字幕条「访问文件」+ 路径 |
| `file-safety.bulk-delete.needs-approval` | **橙色「等你审批」** + 跳一下 + 气泡提醒 |
| `...approved` / `...rejected` | 字幕条播报已批准 / 已拒绝 |

- 800ms 一跳，按 `toolCallId` 去重，工具事件 800ms 节流（审批不节流，怕漏）
- 首次启动跳到文件末尾，不回放历史；跨天自动切到新文件
- 右键「**WorkBuddy 活动（只读）**」可以关掉

**为什么不能回复**：WorkBuddy 的对话在云端，本地没有可投递的消息入口。它确实开了几个本地 HTTP 服务（`127.0.0.1:18488`、`61984`），但

- `61984` 是「CodeBuddy Remote Control」，`/api` 返回 `AUTH_REQUIRED`，需要配对凭证
- `18488` 对常见路径（`/health`、`/mcp`、`/rpc`…）全是 404，属于内部协议

硬接这种未公开 + 鉴权的接口，版本一升就会坏，所以只做只读展示。真要「回复」，目前稳的做法是把内容复制到剪贴板、你手动粘到 WorkBuddy 输入框。

## 12. 接入 cc-switch 的方式

cc-switch 把一切存在 `~/.cc-switch/`：

```
~/.cc-switch/cc-switch.db     SQLite：providers / provider_health /
                              proxy_request_logs / usage_daily_rollups …
~/.cc-switch/settings.json    当前供应商指针（currentProviderCodex 等）
```

### 只读监控（默认行为）

每 2.5 秒读一次数据库（`readOnly` 打开，不影响 cc-switch 写入）：

- `providers` → 供应商列表与 `is_current`
- `provider_health` → 健康灯
- `proxy_request_logs` → 最近请求、失败、最后活动时间（时间戳同时兼容秒和毫秒）
- `usage_daily_rollups` → 今日用量；日汇总没生成时回退到直接滚日志

### 切换供应商（需授权）

首次在卡片里点别的供应商会弹确认框，说明会写哪些文件。同意后：

1. 备份现有配置文件 + `cc-switch.db` 到 `%APPDATA%/deepseek-whale-pet/backups/<时间戳>-<app>/`
2. 按 cc-switch 自己的规则写配置：
   - `claude` → `~/.claude/settings.json`（写 `settings_config` 全文）
   - `codex` → `~/.codex/auth.json` + `~/.codex/config.toml`（分别取 `auth` 与 `config`）
   - `gemini` → `~/.gemini/settings.json`
3. 更新数据库 `providers.is_current`，让 cc-switch 再次打开时认定的当前项一致
4. 写回 `~/.cc-switch/settings.json` 里的 `currentProvider*`

> 注意：cc-switch 运行中会缓存状态，切换后建议重启它。所有写入都是「先备份后落盘」，可用备份目录回滚。

---

## 13. 运行

```bash
npm install          # 已装好则跳过
npm start            # = electron .
```

或双击 **`启动鲸鱼娘.vbs`**（无控制台窗口）。

首次启动会在托盘常驻，角色出现在屏幕右下角。配置文件在：

```
%APPDATA%/deepseek-whale-pet/config.json
```

可调项：位置 `x/y`、大小 `scale`（0.56/0.72/0.9）、`alwaysOnTop`、`autoLaunch`、`allowSwitch`、`showBubble`。

### 打包成便携版 exe

先装打包工具（可选，只有打包才需要）：

```bash
npm i -D @electron/packager resedit
```

**方式 A：electron-packager**（一行搞定，但需要联网下载 Electron 压缩包）

```bash
npx electron-packager . 鲸鱼娘 --platform=win32 --arch=x64 \
  --icon=assets/icon.ico --out=dist --overwrite --prune=true \
  --ignore="^/dist" --ignore="^/scripts"
```

**方式 B：手动组装**（网络受限时用，不需要下载任何东西）

```bash
# 1) 复制本地已有的 Electron 运行时，并把 exe 改成想要的名字
robocopy node_modules\electron\dist dist\鲸鱼娘 /E
ren "dist\鲸鱼娘\electron.exe" "鲸鱼娘.exe"

# 2) 把应用文件塞进 resources\app
mkdir dist\鲸鱼娘\resources\app
copy main.js preload.js preload-reply.js package.json dist\鲸鱼娘\resources\app\
xcopy src dist\鲸鱼娘\resources\app\src /E /I
xcopy renderer dist\鲸鱼娘\resources\app\renderer /E /I
xcopy assets dist\鲸鱼娘\resources\app\assets /E /I

# 3) 写入图标与版本信息（纯 JS，不需要 rcedit）
node scripts/patch-exe.js "dist/鲸鱼娘/鲸鱼娘.exe"
```

> 打包版沿用同一个 `%APPDATA%\deepseek-whale-pet` 目录，所以存档会跟着走。

---

## 14. 目录

```
deepseek-whale-pet/
├─ main.js                主进程：窗口/托盘/菜单/轮询/切换授权
├─ preload.js             contextBridge 白名单 API
├─ src/ccswitch.js        cc-switch 数据桥（读 + 受控写）
├─ src/skins.js           皮肤包扫描与动作轨解析
├─ src/voice.js           Edge TTS 合成 + 缓存（失败回落系统语音）
├─ src/livefeed.js        会话日志 tail → 实时字幕事件
├─ src/wbchat.js          WorkBuddy projects/*.jsonl → 实时字幕（含明文 CoT）
├─ src/reply.js            定位会话 + codex exec resume 回灌
├─ src/wbfeed.js           WorkBuddy 审计流 tail（只读）
├─ src/gameplay.js        成就 / 旅行 / 收藏 / 预算 / 预测
├─ src/petstate.js        养成纯逻辑（亲密度 / 小鱼干 / 段位）
├─ src/growstore.js       养成存档持久化
├─ src/store.js           配置持久化
├─ renderer/
│  ├─ index.html
│  ├─ style.css           毛玻璃卡片 / 气泡 / 穿透布局
│  └─ app.js              精灵图动画、情绪状态机、交互
├─ assets/
│  ├─ skins/whale/        鲸鱼娘皮肤包（sheet 模式）
│  ├─ skins/claude/       Claude 娘皮肤包（frames 模式，27 帧 + LICENSE）
│  ├─ whale-girl-refined.webp   8×9 动作图集（192×208/格）
│  ├─ pet.json                  图集帧数与节奏
│  ├─ previews/                 九个动作的 GIF 预览（来自原始素材包）
│  ├─ avatar.png / tray.png / icon.png
├─ scripts/
│  ├─ test-switch.js      沙箱测试：在临时副本上跑一次 cc-switch 切换
│  ├─ test-grow.js        养成逻辑测试（35 条断言）
│  ├─ test-meta.js        进食/饱食度测试（23 条断言）
│  ├─ test-gameplay.js    成就/旅行/预算测试（28 条断言）
│  ├─ test-reply.js       会话发现 / 清洗 / 会话画像（22 条断言）
│  ├─ test-wbfeed.js      WorkBuddy 审计流映射（12 条断言）
│  └─ test-live.js        实时字幕解析测试（17 条断言）
├─ 启动鲸鱼娘.vbs          静默启动（推荐双击）
├─ 启动（调试）.bat        带控制台启动，方便看报错
├─ LICENSE               代码 MIT
└─ LICENSE-ASSETS.md     立绘 CC BY-NC-SA 4.0
```

### 图集约定

8 列 × 9 行，单元格 192×208，行序：

```
0 idle · 1 running-right · 2 running-left · 3 waving · 4 jumping
5 failed · 6 waiting · 7 running · 8 review
```

换形象只需替换 `assets/whale-girl-refined.webp` 并同步 `renderer/app.js` 里的 `TRACK`。

---

## 15. 已知取舍

- **只支持 Windows 桌面**：托盘、`setIgnoreMouseEvents` 穿透、贴边吸附都按 Windows 行为调的。
- **codex 的 `config.toml` 是整段覆盖**：因为 cc-switch 的 `settings_config.config` 本身就是完整 TOML；如果有手写的额外段落，请用备份恢复后再改。
- **花费显示为 0** 属于正常：cc-switch 对 `codex_session` 来源的日志没有定价，只有 token 数。
- 切换逻辑已在沙箱副本上验证（claude / codex 各切一次，`is_current` 计数正确、备份齐全），未在真实配置上做破坏性测试。
- 「回合」用请求数折算只是近似：cc-switch 不记录 agent 回合边界，所以摸头/喂食才是玩家能主动控制的收益来源。
- 实时字幕是**日志级**而不是**流式**：Codex 写盘以 item 为单位，所以看到的是「一段一段」而不是逐 token；要真正逐字推送只能挂在它的 socket 上，稳定性不如读日志。
- Codex 的 CoT 加密，无法显示原始思考；Claude Code 可以。
- 段位只影响称号、进度条和台词热度，**没有做换装**（原作有星级换装，需要额外的图层素材）。
- 旅行是本地计时，关掉程序期间也在走；但「期间的饭量」只有在程序运行、能读到 token 时才算得准。
- 成就判定依赖本地存档，删掉 `pet-grow.json` 会一起清空。
- 语音走的是微软在线接口，**断网就只能用系统语音**（Huihui，音质差一档）；也不要在意隐私的话把长文本念出去——只念最后一句就是为此。
- 账单里的「缓存省下多少」只统计 cc-switch 记录到的请求；直接用 curl 调供应商 API 的那部分不在内。
- 会话标题依赖 Codex 的 `state_5.sqlite`，Codex 升级改表结构时这里需要跟着改。
- 「回复当前任务」本质是**新起一个 codex 进程续写同一会话**。如果原窗口正开着同一会话，两边会同时写 rollout，可能产生重复/错乱的对话记录；建议原窗口空闲时再用，或干脆只在宠物里操作。
- 回复走的是 `codex exec`，所以是**纯文本往返**：看不到它在你原窗口里已经渲染的富内容，也不会同步图片附件。

---

## 许可

- **代码**（`*.js` / `*.html` / `*.css` / 脚本）：[MIT](LICENSE)，随便改、随便发，保留版权声明即可。
- **立绘与精灵图集**（`assets/` 下的 `*.webp` / `*.png` / `*.gif`）：[CC BY-NC-SA 4.0](LICENSE-ASSETS.md)，署名 · 非商业 · 相同方式共享。**不能拿去卖**；要商用请换成自己的图。
- 逐项来源与上游许可原文：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

