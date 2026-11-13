# Claude 娘 立绘授权与署名

本目录下的立绘（`*.webp`，共 27 帧）来自开源项目 **CrossPet**，不是本项目原创。

- 仓库：https://github.com/lokicorvus/crosspet
- 路径：`characters/claude/`
- 许可：**CC BY-NC-SA 4.0**（署名 · 非商业性使用 · 相同方式共享）
  协议原文：https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
- 上游授权说明：https://github.com/lokicorvus/crosspet/blob/main/characters/LICENSE.md

## 角色来源

CrossPet 明确注明：Claude 形象取自**社区流行的 Claude 娘设定**（铜橙色长发、橙花发饰、抱书）。
「Claude」「Anthropic」是 Anthropic 的商标，本项目与 Anthropic 无任何隶属关系，属非官方同人作品。

## 本项目的改动

1. 从上游 57 帧中挑选 27 帧；
2. 所有帧重新对齐到 600×640 透明画布（底部居中），解决原帧宽度不一导致的抖动；
3. 以 WebP q88 重新编码，体积从约 4.0MB 降到 2.3MB；
4. 新增 `skin.json`，把帧映射到本项目的动作轨（idle / running / failed / waiting / sleep / waving / jumping / review）；
5. 台词部分改写了少量条目（`lines` / `greetings`），其余沿用上游设定。

按 CC BY-NC-SA 4.0 的「相同方式共享」要求，上述改动后的立绘同样以 CC BY-NC-SA 4.0 发布。

## 使用限制

**不得用于商业用途。** 若你要商用，请自行替换本目录的立绘（换成你拥有版权的素材），代码部分仍为 MIT。
