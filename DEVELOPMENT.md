# Auto Beautiful Mermaid — 开发规范

## 架构原则

### 完全接管所有 Mermaid 块
插件接管 **每一个** `mermaid` fence，不放行任何类型给 Obsidian 原生渲染器。
类型只决定默认模式和按钮集：

| 类型 | 默认模式 | 按钮 |
|------|----------|------|
| 支持类型（flowchart/state/sequence/class/er/xychart） | Beautiful | Beautiful / System / Both / Source |
| 不支持类型（timeline/gantt/mindmap/pie/…） | System | System / Source |

Beautiful slot 仅在支持类型时创建；不支持类型**不创建** Beautiful slot，不调用 `renderBeautiful`。

---

## 双图问题根因 & 修复（已验证）

这是这个项目最容易踩的坑，完整记录防止重蹈覆辙。

### 根因 1：Reading View — Obsidian 预填 `el`

Obsidian 调用 `registerMarkdownCodeBlockProcessor` handler 之前，会在 `el` 里**预填** `<pre><code class="language-mermaid">` 节点。  
如果 `mountMermaidBlock` 只是往 `el` 里追加 `.abm-block`，原来那个节点还在，原生 PostProcessor 扫到它，渲染出第二个裸图。

**修复（`src/main.ts` `mountMermaidBlock` 首行）：**
```ts
// 必须在 mount 前清空 host，否则 Obsidian 预填的 code.language-mermaid 会被原生 PP 二次渲染
while (host.firstChild) host.removeChild(host.firstChild);
// 不用 host.empty()——那是 Obsidian 扩展方法，jsdom 测试环境没有，会 throw
```

### 根因 2：Live Preview — Obsidian 独立的 mermaid StateField

我们的 `Decoration.replace(fence.from, fence.to)` 替换的是 fence **文本**，但 Obsidian 有自己独立的 mermaid StateField，在 `cm-preview-code-block.cm-lang-mermaid` 里渲染 `div.mermaid`。两套 decoration 互不干涉，同时出现。

**DOM 结构（验证过）：**
```
cm-content
  ├── DIV ""                              ← 我们的 widget host（abm-block 父）
  │     └── .abm-block
  ├── DIV cm-line ...                     ← 其他行
  ├── DIV cm-preview-code-block.cm-lang-mermaid  ← Obsidian 原生 widget
  │     └── div.mermaid                   ← 第二个图
```

**修复（`styles.css`）：**
```css
/* 插件接管所有 mermaid fence，原生 widget 永远是冗余的，全局隐藏 */
.cm-preview-code-block.cm-lang-mermaid {
  display: none !important;  /* !important 必须——Obsidian 自身样式会覆盖 */
}
```

### 根因 3：System 模式 — 不要用 `MarkdownRenderer.render`（已废弃）

旧方案用 `MarkdownRenderer.render` + `recreateNativeFence` 在 System slot 里造 `code.language-mermaid` 让原生 PP 渲染——这会被 section 级 PP 二次扫描产生裸图，无法修复。

**正确方案：`loadMermaid()`**
```ts
import { loadMermaid } from "obsidian";

private mermaidInstance?: Promise<MermaidEngine>;

private loadMermaidOnce(): Promise<MermaidEngine> {
  if (!this.mermaidInstance) {
    // 失败时清掉缓存，下次可以重试
    this.mermaidInstance = (loadMermaid() as Promise<MermaidEngine>)
      .catch((e) => { this.mermaidInstance = undefined; throw e; });
  }
  return this.mermaidInstance;
}

private async renderSystemInto(slot: HTMLElement, source: string): Promise<void> {
  try {
    const m = await this.loadMermaidOnce();
    const res = await m.render(`abm-sys-${this.systemIdCounter++}`, source);
    appendSvg(slot, typeof res === "string" ? res : (res.svg ?? ""));
  } catch (e) {
    renderError(slot, "system", e, source);
  }
}
```

---

## 双图诊断流程（DevTools Console）

出现双图时，按以下顺序查，**不要靠推理改代码**。

```js
// Step 1 — 定位所有 mermaid 相关节点
document.querySelectorAll('.abm-block, .mermaid, .cm-preview-code-block').forEach((el, i) => {
  const r = el.getBoundingClientRect();
  console.log(i, el.className.slice(0, 60), 'top:', Math.round(r.top),
    'parent:', el.parentElement?.className?.slice(0, 60));
});
// 结果解读：
//   .mermaid 和 .abm-block 的 top 相近 → Live Preview 双图（根因 2）
//   只有 .abm-block，.mermaid 不存在 → Reading View 问题（根因 1）

// Step 2 — 确认 Live Preview CSS 是否生效
getComputedStyle(document.querySelector('.cm-preview-code-block.cm-lang-mermaid')).display
// 'none' → CSS 生效；'block' → !important 缺失或选择器不对

// Step 3 — 确认 JS 隐藏可以解决（验证思路）
document.querySelectorAll('.cm-preview-code-block.cm-lang-mermaid').forEach(el => el.style.display = 'none')
```

**先问用户**："有几个图，带 toolbar 的有几个？"  
- 一个带 toolbar + 一个裸图 → 双图问题，走上面流程  
- 两个都带 toolbar → 插件被加载了两次，检查 vault 安装

---

## 部署 & 验证流程

```bash
# 1. 构建
npm run build  # tsc 类型检查 + esbuild bundle

# 2. 测试
npx vitest run  # 必须全绿（当前基线：64 tests）

# 3. 部署到 vault
VAULT=~/Documents/obsidian-notes/.obsidian/plugins/auto-beautiful-mermaid
cp main.js styles.css "$VAULT/"

# 4. 验证哈希一致
shasum main.js "$VAULT/main.js"

# 5. Obsidian 里：设置 → 社区插件 → Auto Beautiful Mermaid → 禁用 → 启用
# obsidian reload 不足以加载新 JS，必须 toggle 插件
```

### 结构验证（每次 build 后）
```bash
# D3 不变量：bundle 里不能有运行时产生 language-mermaid class 的代码
grep -c 'className.*language-mermaid\|language-mermaid"' main.js
# 期望：0（注释里的字符串不算）

# 诊断代码不能进入 main.js
grep -c 'ABM-DIAG' main.js
# 期望：0
```

---

## 测试规范

- 测试基线：**64 tests**，全绿才能 commit
- 关键测试覆盖：
  - `no-double-render invariant`：owned block 不产生 `code.language-mermaid` 节点
  - `loadMermaid` 缓存：多次调用只 load 一次
  - load 失败不毒化缓存：失败后下次重试
  - `renderSystemInto` 异常走 `renderError` 错误框

mock 位于 `test/mocks/obsidian.ts`，提供：
- `loadMermaid` mock（可注入 render 实现）
- `__setMermaidRender` / `__failNextLoad` / `__loadMermaidCalls` / `__resetMermaid` 测试控制函数

---

## commit 规范

- **实现 + spec archive 合一个 commit**，不拆开
- 诊断代码（`console.log`、`ABM-DIAG`）必须在 commit 前删除，不进主分支
- message 格式：`fix:` / `feat:` / `chore:` + 一句话说清楚做了什么和为什么
