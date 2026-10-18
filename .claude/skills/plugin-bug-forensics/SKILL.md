---
name: plugin-bug-forensics
description: >
  本项目已确认 bug 的取证档案库与排查手册。用户报告本插件功能异常(渲染失败、
  切换失效、lint/CI 问题)时,先来这里查已知模式,新确认的 bug 处理完后按
  格式追加。Use when the user reports any plugin malfunction, rendering
  failure, toggle problem, or lint/CI issue in auto-beautiful-mermaid.
metadata:
  author: auto-beautiful-mermaid
  version: "1.1"
---

每类已确认 bug 一个档案文件(表象 → 根因 → 修复 → 验证方法 → 禁止事项)。
本文件只管路由与规则;档案正文在 `references/`,排查到哪一步读哪个档案。

---

## 档案索引

| 档案 | 表象关键词 | 文件 |
|---|---|---|
| #001 | 实时预览点工具栏没反应 / 模式弹回 / 切换后看不到渲染 | [references/001-live-preview-toggle-click-destroyed.md](references/001-live-preview-toggle-click-destroyed.md) |
| #002 | 错误框 "system failed to render" + "Mermaid renderer returned invalid SVG";多行 label(`<br/>`)的图 | [references/002-system-render-invalid-svg.md](references/002-system-render-invalid-svg.md) |
| #003 | 官方市场 bot lint 警告(prefer-create-el);接 lint 时的语义陷阱 | [references/003-lint-prefer-create-el-traps.md](references/003-lint-prefer-create-el-traps.md) |
| #004 | 弹出窗口里缩放按钮点不动 / 连点重置为适应大小;任何"弹出窗口里坏、主窗口正常" | [references/004-popout-zoom-controls-cross-realm.md](references/004-popout-zoom-controls-cross-realm.md) |

**表象未命中任何档案** → 走下方"排查通用流程"。

## 使用规则

1. **先对照,再排查**——表象命中某档案时,跳过去按"验证方法"确认,不要从头推理
2. **二分在前,环境在后**——未命中时先问:哪个视图表面(Reading / Live Preview)?哪个模式?错误框还是纯源码?错误消息文字是什么?确认复现路径后再怀疑外部环境(Obsidian 版本、其他插件)
3. **不许无证据改码**——先拿到 DOM/console 证据或最小复现(同 double-render-debug 规则)
4. **全量回归**——修复后用 vault 真实 fence 全量验证,不满足于手造样例
5. **处理完必追加**——新 bug 确认修复后,按既有档案的五段格式新建 `references/NNN-<slug>.md`,并在上表加一行

## 排查通用流程(未命中档案时)

1. **二分定位**(一个 AskUserQuestion 就够):视图 × 模式 × 错误形态 × 消息文字
2. **拿一手证据**:用户 DevTools console;或本地 Playwright 复现(用 Obsidian 同版本 `/lib/mermaid.min.js` + 相同 initialize 参数)
3. **对照项目不变量**:
   - never 产出 `code.language-mermaid`(no-double-render,见 double-render-debug skill)
   - SVG 注入必须容忍 mermaid 的 HTML-in-SVG 输出(#002)
   - Live Preview widget 内交互控件 = mousedown preventDefault + ignoreEvent 豁免(#001)
   - 游离元素 = 裸全局 `createDiv()`,永不 `document.createDiv()`(#003)
   - 弹出窗口可达的代码不对 DOM 用 `instanceof`,用 `composedPath()` / `contains()` / `instanceOf()`(#004)
4. **修复 → 全量回归 → 部署**(`/deploy-and-verify`)→ **追加档案**
