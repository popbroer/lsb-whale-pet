# 第三方素材与署名

本项目的**代码**可自由修改使用；**角色与图像素材**来自社区同人创作，不属于本项目原创，也不属于 DeepSeek 官方作品。

## 角色来源（按创作顺序）

| 环节 | 作者 / 项目 | 说明 |
| --- | --- | --- |
| 一创 | 上善无形（Bilibili / Pixiv） | 原创角色「溟月」，蓝发、鲸鳍耳、鲸尾、呆毛。以 **CC BY-NC-SA 4.0** 开放二创：需署名、非商业、相同方式共享 |
| 二创 | ZipZipPipe（Pixiv） | 在「溟月」基础上加入 DeepSeek 元素，形成女仆鲸鱼娘 |
| 三创 | Small-tailqwq | `dsh-deep-whale` 皮肤家族的再设计 |
| 皮肤移植 | ZHOUcourier / zhenhua520（[dsh-whalegirl](https://github.com/zhenhua520/dsh-whalegirl)） | DSH 皮肤化 |
| 角色规范 | [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan) | 角色设定、比例与生成工具链的社区规范 |

## 本仓库使用的图像文件

`assets/whale-girl-refined.webp`、`assets/pet.json`、`assets/previews/*.gif`

- 来源：npm 包 `@linxin666/dsh-pet@0.4.18`，仓库 [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)
- 该包内置的 `whale-girl-refined`（鲸鱼娘·精致版）为 AI 辅助二创/精修版本，其 `pet.json` 声明 `license: MIT`；精致版参考自 DreamSkin 的「DeepSeek-Whale」主题（原作者记录为 powerdog996，标注 MIT）
- 包内代码许可：BSD-3-Clause
- 本次仅原样复制图集文件与 `pet.json`，未做修改；`avatar.png`、`tray.png`、`icon.png` 为从该图集裁剪/缩放得到的衍生图标

## 代码层面的参考

`src/petstate.js`（亲密度 / 小鱼干 / 段位）的规则与常量移植自 `@linxin666/dsh-pet` 的 `src/affinity.ts`、`src/treats.ts`：

- 原项目代码许可：**Apache-2.0**（v0.4.18 `package.json`）
- 移植内容：点数与冷却（摸头 +1/10s、喂食 +5/30s）、九段位阈值、小鱼干产出（30 回合 / 5 小时、上限 20）、结算水位线算法
- 本地改动：回合由请求数折算、见面礼 3 条、文案全部重写为中文白饭梗
- 未复制其源码文本，仅按规则重写实现；如需逐行对照，见上游 `src/affinity.ts` / `src/treats.ts`

## Claude 娘立绘（`assets/skins/claude/`）

- 来源：**CrossPet** — https://github.com/lokicorvus/crosspet
- 路径：`characters/claude/`
- 许可：**CC BY-NC-SA 4.0**
  协议：https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
  上游说明：https://github.com/lokicorvus/crosspet/blob/main/characters/LICENSE.md
- 角色设定来源：社区流行的 Claude 娘设定（铜橙长发、橙花发饰、抱书）
- 「Claude」「Anthropic」是 Anthropic 的商标；本项目的该皮肤为非官方同人素材，与 Anthropic 无隶属关系
- 本项目改动：27 帧重新对齐到 600×640 画布、WebP q88 重编码、新增 skin.json 动作轨映射、部分台词改写
- 按 CC BY-NC-SA 4.0 的相同方式共享条款，改动后的立绘同样以 CC BY-NC-SA 4.0 发布
- **不得商用**；商用请替换该目录立绘（代码仍为 MIT）

## 语音

- 音色由 `edge-tts`（MIT）调用微软在线语音合成服务生成，不随本项目分发任何音频文件或模型权重
- 合成结果缓存在用户本机 `%APPDATA%/deepseek-whale-pet/voice-cache`，可用性受微软服务条款约束

## 使用限制

- 鲸鱼娘为**社区同人形象**，`DeepSeek` 名称与鲸鱼标识归 DeepSeek（杭州深度求索）所有；本项目与 DeepSeek 无隶属、赞助或官方授权关系，不将该形象呈现为官方作品。
- 角色美术素材遵循 **CC BY-NC-SA 4.0**：署名、**非商业使用**、衍生作品以相同方式共享。
- 商用或公开再分发前，请自行核对许可并取得相应授权。
