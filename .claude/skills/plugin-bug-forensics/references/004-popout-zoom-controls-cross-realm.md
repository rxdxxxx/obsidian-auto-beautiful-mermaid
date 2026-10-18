# 档案 #004 — 弹出窗口里缩放按钮点不动 / 连点重置为适应大小

**确认日期**: 2026-10-19 · **修复 commit**: `7d11d87` · **发版**: 未发版(`feature/diagram-popout-viewer`)

## 表象

- 弹出窗口(pan/zoom 查看器)里点右下角 −/+/Fit:有时毫无反应(百分比和图都不变)
- 有反应时,很快再点一下又被重置回适应窗口的缩放比例
- 滚轮/触控板缩放、拖拽平移都正常——只有角落按钮坏
- 用户一度报告"System 正常、Beautiful 和 Both 不正常"——**是假线索**,复测 System 同样坏(间歇性表象)

## 根因

弹出窗口是独立的 window(独立 JS realm)。查看器 DOM 属于弹出窗口,插件代码里的全局 `Element` 是主窗口的,所以 `event.target instanceof Element` **恒为 false**,`src/panzoom.ts` 的"是否点在控件上"守卫从不生效:

1. `onPointerDown`:按下按钮被当作拖拽开始 → `viewport.setPointerCapture()` → 指针被捕获,`pointerup`/`click` 被重定向到 viewport → 按钮自己的 click 处理器从未执行
2. `onDoubleClick`:连点按钮冒泡出 `dblclick` → `fit()` → 缩放被重置

DevTools 一手证据(两种渲染器一致):`plusIsMainWindowsElement: false`;`pointerdown → BUTTON.abm-pz-btn`、`pointerup → DIV.abm-diagram-viewport.is-panning`、`click → DIV.abm-diagram-viewport`。

## 修复

两处守卫改为 `event.composedPath().includes(controls)`——按事件传播路径判断,与节点由哪个 window 创建无关,也无需类型断言。

## 验证方法

- 弹出窗口里 −/+/Fit 单击每次生效;连点 + 持续放大、不回弹;Beautiful / System / Both 三种都测
- 回归测试:`src/panzoom.test.ts` 的 "in a pop-out window" 组——`vi.stubGlobal("Element", class {})` 模拟跨 realm,旧代码两条都失败

## 禁止事项

- 弹出窗口可达的代码里不要对 DOM 节点/事件用 `instanceof Element/HTMLElement/...`;用 `composedPath()`、`container.contains()`,或 Obsidian 的跨窗口 `node.instanceOf(T)` / `event.instanceOf(T)`
- 不要拿 jsdom 测试结果证明跨窗口行为:jsdom 的 iframe 与主文档**共享一个 realm**,`instanceof` 照样为 true(本次已实测)

## 诊断教训

- 先给用户一段只读 DevTools 片段(弹出窗口里 Cmd+Option+I)抓 `elementFromPoint`、realm 判定、`pointerdown/pointerup/click` 的 target——一轮就定位,比 jsdom/iframe 推演可靠
- "某渲染器正常"的二分信号要复测确认;间歇性 bug 会制造假的渲染器差异
- 同类隐患:`src/main.ts` 的 `MermaidEditorWidget.ignoreEvent` 也用了 `instanceof HTMLElement`。笔记拖进弹出窗口后它恒返回 false,但 #001 的第一层防御(mousedown `preventDefault`)足够,实测 Live Preview 切换仍正常,暂未改