## Why

The System view's rendering mechanism causes a confirmed Reading View
double-render. System mode renders by feeding a ```` ```mermaid ```` fence to
`MarkdownRenderer.render` and, via a `systemRenderDepth` re-entry guard,
recreating a `<pre><code class="language-mermaid">` inside the System slot so
Obsidian's native PostProcessor draws it. But Obsidian's **section-level** mermaid
PostProcessor independently scans the whole section for `code.language-mermaid`
right after our processor returns and renders that recreated fence a **second**
time — a bare, toolbar-less diagram. Runtime logs on a `timeline` block confirm:
one re-entry, two diagrams (one in our toolbar container, one bare). The timing of
that outer scan is not controllable, so no post-hoc patch (class-rename, depth
juggling) reliably prevents it.

The reference plugin (qiaoborui/obsidian-beautiful-mermaid) never double-renders
precisely because it only ever uses its own renderer and never produces a
`code.language-mermaid` for Obsidian's PostProcessor to find. We adopt the same
principle for System mode while still using Obsidian's own mermaid engine.

## What Changes

- **Render System mode via Obsidian's public `loadMermaid()` API** instead of
  `MarkdownRenderer.render`: `const mermaid = await loadMermaid(); const { svg } =
  await mermaid.render(uniqueId, source)`, then inject the parsed SVG into the
  System slot with `DOMParser` + `appendChild` (never `innerHTML`). The mermaid
  instance is cached on the plugin (load once).
- **BREAKING (internal):** delete `recreateNativeFence` and the entire
  `systemRenderDepth` re-entry-guard mechanism. `renderSystemInto` no longer calls
  `MarkdownRenderer.render` and no longer produces any `code.language-mermaid`.
- On `mermaid.render` rejection (e.g. a syntax error) show our `renderError` box,
  consistent with the Beautiful failure path.
- Applies to **both** Reading View and Live Preview System rendering.
- Supersedes the recreate-pre System mechanism introduced by the in-flight
  `mermaid-render-mode-toggle` change.

## Capabilities

### New Capabilities
<!-- None: this revises an existing capability's mechanism. -->

### Modified Capabilities
- `mermaid-render-mode`: the System view is produced by calling `loadMermaid()`
  and `mermaid.render` directly and injecting the SVG, rather than by
  `MarkdownRenderer.render` + a recreated native fence. The no-double-render
  guarantee now rests on the plugin never emitting `code.language-mermaid` at all
  (so Obsidian's PostProcessor has nothing to scan), not on processor ordering or
  a re-entry guard.

## Impact

- **Code:** `src/main.ts` — `renderSystemInto` (rewrite to `loadMermaid`), delete
  `recreateNativeFence` + `systemRenderDepth` + the re-entry branch in
  `handleMermaid`; add a cached mermaid instance + unique-id counter; reuse the
  existing `appendSvg`. `src/main.test.ts` — mock `loadMermaid`, drop re-entry/depth
  tests, assert the System slot receives the injected SVG and shows `renderError`
  on rejection. `test/mocks/obsidian.ts` — add a `loadMermaid` export.
- **APIs:** depends on Obsidian's public `loadMermaid()` (declared in
  `obsidian.d.ts`, peer of `loadMathJax`/`loadPrism`). No new npm dependency, no
  bundled mermaid.
- **Behavior:** System view is visually Obsidian-native, supports all diagram
  types (timeline/gantt/mindmap/…); the Reading View and Live Preview
  double-render is eliminated by construction.
