# Auto Beautiful Mermaid

[English](README.md) | 中文

一款 [Obsidian](https://obsidian.md) 插件：接管所有 `mermaid` 代码块，让你逐块或按 vault 统一选择用哪个引擎渲染。

三个渲染器，一个工具栏：

| 渲染器 | 是什么 | 覆盖范围 |
|-------|--------|---------|
| **Beautiful** | [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) —— 以美观为目标，输出精致的主题自适应 SVG | 6 种类型 |
| **Pele** | [pele](https://github.com/obsidianmd/pele) —— Obsidian 官方 Mermaid 渲染器：同步、零运行时依赖、颜色走 CSS 变量 | 22 种类型 |
| **System** | Obsidian 内置 Mermaid 引擎 | Mermaid 支持的全部类型 |

阅读视图（Reading View）与实时预览（Live Preview）均已覆盖，且保证一个代码块只渲染一次，不会重复。

## 功能特性

- ✅ 三个可互换的渲染器，悬停工具栏即可逐图切换
- ✅ vault 级「默认渲染器」设置
- ✅ 完整的 Mermaid 类型覆盖 —— 任何图表都不会掉到错误框
- ✅ Pele 能画 beautiful-mermaid 画不了的类型（gantt、pie、mindmap、timeline……）
- ✅ 三种渲染器都自动适配亮/暗主题
- ✅ 在新窗口中打开：将当前视图（Beautiful、Pele、System 或上下叠放的 All）弹出到独立窗口，支持滚轮/触控板缩放、拖动平移、双击适应窗口（移动端以新标签页打开）
- ✅ 支持实时预览（CodeMirror EditorExtension）
- ✅ 零冲突 —— 完全接管所有 `mermaid` 代码块

## 工具栏模式

鼠标悬停在已渲染的块上即出现工具栏。按钮只在对应渲染器能画该图时才显示：

| 按钮 | 显示内容 |
|------|---------|
| **Beautiful** | beautiful-mermaid 的输出 |
| **Pele** | pele 的输出 |
| **System** | Obsidian 原生 Mermaid 的输出 |
| **All** | 所有支持该类型的渲染器上下叠放，方便对比 |
| **Source** | 原始代码 |

选择按代码块源码在会话内记忆。**Source** 始终可用，随时可以回到原文。

## 选择默认渲染器

**设置 → 第三方插件 → Auto Beautiful Mermaid → 默认渲染器。** 新建的块以所选渲染器开局，工具栏仍可逐块覆盖。修改设置会清空逐块选择并立即重绘已打开的视图。

怎么选：

- **Beautiful**（默认）—— 流程图、时序图、状态图、类图、ER 图、XY 图表最好看。如果你大部分图属于这几类，选它。
- **Pele** —— 覆盖类型多得多，大图速度也更快，代价是视觉风格更朴素（正交折线、类图/ER 方框更简单）。适合大量写 gantt/mindmap/timeline/pie 的场景。
- **System** —— 参考实现。想要与 Mermaid 完全一致的渲染结果时使用。

所选渲染器画不了的类型会自动回落到 System。

## 支持的图表类型

| 类型 | 关键词 | Beautiful | Pele |
|------|--------|:---------:|:----:|
| 流程图 | `flowchart` / `graph` | ✅ | ✅ |
| 时序图 | `sequenceDiagram` | ✅ | ✅ |
| 状态图 | `stateDiagram` / `stateDiagram-v2` | ✅ | ✅ |
| 类图 | `classDiagram` | ✅ | ✅ |
| ER 图 | `erDiagram` | ✅ | ✅ |
| XY 图表 | `xychart` / `xychart-beta` | ✅ | ✅ |
| 甘特图 | `gantt` | — | ✅ |
| 饼图 | `pie` | — | ✅ |
| 思维导图 | `mindmap` | — | ✅ |
| 时间线 | `timeline` | — | ✅ |
| 用户旅程 | `journey` | — | ✅ |
| Git 图 | `gitGraph` | — | ✅ |
| 四象限 | `quadrantChart` | — | ✅ |
| 桑基图 | `sankey-beta` | — | ✅ |
| 块图 | `block-beta` | — | ✅ |
| 架构图 | `architecture-beta` | — | ✅ |
| 看板 | `kanban` | — | ✅ |
| 雷达图 | `radar-beta` | — | ✅ |
| 矩形树图 | `treemap-beta` | — | ✅ |
| C4 | `C4Context` / `C4Container` / … | — | ✅ |
| 数据包 | `packet-beta` | — | ✅ |
| 需求图 | `requirementDiagram` | — | ✅ |

所有类型都可以用 **System** 模式渲染。Beautiful 和 Pele 都不支持的类型（例如 `zenuml`）只提供 System 和 Source 两个按钮。

Pele 对齐 Mermaid 12.1 语法，但有自己的布局和视觉风格，覆盖面随版本持续扩大。本插件内置 pele **1.12**：中文、日文标签按字符换行，支持更多行内 HTML 标签，输出的 SVG 保证是合法 XML，并且用 `style`/`classDef` 自定义填充时标签在暗色主题下依然清晰可读。遇到 Pele 的渲染问题，先看看 [pele 的 issue 列表](https://github.com/obsidianmd/pele/issues) 是否已有记录。

## 安装

### 社区插件商店（推荐）

1. 打开 Obsidian 设置 → 第三方插件 → 浏览
2. 搜索 **Auto Beautiful Mermaid**
3. 点击安装，然后启用

### 手动安装

1. 从 [最新 Release](https://github.com/rxdxxxx/obsidian-auto-beautiful-mermaid/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/auto-beautiful-mermaid/`
3. 重新加载 Obsidian，在设置 → 第三方插件中启用

## 兼容性

- 最低 Obsidian 版本：**1.4.0**
- 与 `beautiful-mermaid-renderer` 插件冲突 —— 两者都装时请禁用其一
- Pele 链接：放行了 `click A "obsidian://..."`，节点链接可以打开 vault 内笔记；`javascript:` 等不安全 scheme 由 pele 自身过滤

## 开发

```bash
npm install
npm run dev      # 监听模式
npm run build    # 生产构建
npm run test     # 单元测试
npm run lint     # obsidianmd eslint 规范
```

详细架构说明和双重渲染问题根因分析见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## 许可证

[MIT](LICENSE)
