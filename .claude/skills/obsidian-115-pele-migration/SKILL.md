---
name: obsidian-115-pele-migration
description: >
  Obsidian 1.15 把内置 Mermaid 引擎从 mermaid.js 换成了 Pele,本插件的
  Pele/System 两个模式会开始重叠。用户提到 Obsidian 1.15、内置 Pele、
  System 和 Pele 渲染结果一样、升级后按钮重复、pele 内置适配时使用本 skill。
  Use when adapting this plugin for Obsidian 1.15+, where Pele replaces the
  bundled Mermaid engine and the Pele/System modes diverge or collapse.
metadata:
  author: auto-beautiful-mermaid
  version: "1.0"
---

**状态(2026-10-30)**:1.15.0 桌面版已进入 early access(2026-10-22 发布),
public 稳定版仍是 1.14.5(mermaid.js)。尚未在本插件里做适配。等 1.15 转 public
后按下文清单处理,处理完删除本 skill 或在开头标注已解决。

---

## 为什么重要

本插件的三个渲染器里:

- **Beautiful** = `beautiful-mermaid`,自有 SVG 风格,不受影响
- **Pele** = 直接调用 `pele.render()`,输出 Pele SVG
- **System** = 通过 `loadMermaid().render()` 调 Obsidian 内置引擎

1.15 起 **System 的底层就是 Pele**,于是 Pele 和 System 两个按钮渲染同一套
SVG,只有外层包装/样式可能不同。`All` 模式也会从「三家对比」退化成
「Beautiful vs Pele(两份)」。

## 已知事实(来自官方 changelog,勿凭记忆改动)

- 1.15.0 桌面版(early access,2026-10-22):Mermaid 图表改由 Pele 渲染,
  支持 Mermaid 12.1.0 语法;更快、跟随主题色和字体、按笔记宽度自适应、
  可缩放平移。
- 因为 Pele 不能执行代码,Obsidian 移除了「Show Mermaid diagrams in notes」
  设置,图表默认渲染。
- 开发者接口:`--mermaid-*` CSS 变量和 `.pele-*` 类可用;Mermaid 兼容 API
  保留;`loadMermaid()` 之后 `window.pele` 可用。
- Obsidian 不再打包 mermaid.js。
- 来源:
  - https://obsidian.md/changelog/2026-10-22-desktop-v1.15.0/
  - https://github.com/obsidianmd/pele
  - https://github.com/obsidianmd/pele/issues/5(kepano: "It will be in Obsidian 1.15")

## 受影响代码

| 位置 | 现状 | 1.15 下的问题 |
|---|---|---|
| `src/main.ts` `renderSystemInto()` | `loadMermaid().render(id, source)` | 返回值可能变成 Pele SVG;需确认返回结构与 `result.svg` 兼容 |
| `src/main.ts` `PREFERRED_LABELS` | `Pele (Obsidian's new renderer)` / `System (built-in Mermaid)` | 后半句在 1.15 下是错的 |
| `src/main.ts` `offeredModes()` / `offeredRenderers()` | 总是同时提供 pele 与 system | 两者产出一致,按钮冗余 |
| `src/diagram-view.ts` `DiagramRenderer` | `"beautiful" \| "pele" \| "system"` | 可能需要增加能力探测或合并模式 |
| `styles.css` | 自定义 `--mermaid-*` / `.pele-*` 覆盖 | 两套变量在 1.15 下同时存在,需确认优先级 |

## 适配清单

1. **确认 System 行为**——在 1.15 early access 的 DevTools 里跑:
   ```js
   const m = await require('obsidian').loadMermaid?.() ?? window.mermaid;
   const r = await m.render('probe', 'graph TD; A-->B');
   console.log(typeof r, r?.svg?.slice(0, 200) ?? String(r).slice(0, 200));
   console.log('window.pele', typeof window.pele);
   ```
   重点看:返回 string 还是 `{svg}`;输出的 SVG 是否带 `.pele` 类。
2. **能力探测**——用 `typeof window.pele !== "undefined"`(或首次
   `loadMermaid()` 后检测)判断内置引擎是否已是 Pele,再决定 UI。
3. **UI 决策**(二选一,先和用户确认):
   - 1.15+ 隐藏 Pele 按钮,只留 Beautiful / System / All;
   - 或保留 Pele 作为「强制直连 pele 包」的逃生口,但重命名区分。
4. **All 模式**——避免渲染两份相同 SVG;1.15+ 下 All 应只包含
   Beautiful + 内置引擎。
5. **兼容双版本**——在 1.14.5 和 1.15+ 各跑一遍 `npm test`、真实 vault 回归;
   必要时 `manifest.json` 的 `minAppVersion` 仍保持 1.4.0,靠运行时探测分流。
6. **文档**——README/README_CN 的 Pele 行、兼容性说明同步更新;
   升级依赖 pele 到 Obsidian 内置同版本,避免直连路径与内置路径行为不一致。

## 验证方法

- Reading View + Live Preview 各验一遍:Beautiful / System / All 三种模式。
- 确认 `document.querySelectorAll('.mermaid, .pele').length` 与预期一致,
  不出现同一图两份。
- 在 1.14.5 上回归,确保没把旧版用户弄坏。

## 禁止事项

- 不要仅凭 changelog 推断 `loadMermaid().render()` 的返回类型,必须在
  真实 1.15 环境探测。
- 不要删除 System 模式——它是旧版 Obsidian 和 `zenuml` 等类型的兜底。
- 不要用 Obsidian 版本号字符串硬编码分支,优先用 `window.pele` 能力探测。
