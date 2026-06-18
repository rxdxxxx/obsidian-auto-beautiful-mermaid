## Context

The in-flight `mermaid-render-mode-toggle` change renders the System view by
calling `MarkdownRenderer.render("```mermaid…")` and relying on a re-entry guard
(`systemRenderDepth`) that, when our own code-block processor is re-invoked inside
that render, recreates a `<pre><code class="language-mermaid">` so Obsidian's
native mermaid PostProcessor draws it into the System slot.

Verified failure (Obsidian 1.12.7, runtime logs on a `timeline` block):
- timeline is unsupported → default mode System → `ensureSystem` → `renderSystemInto`.
- Inside `MarkdownRenderer.render`, our handler re-enters once (depth=1) and
  `recreateNativeFence` creates a `code.language-mermaid` in the System slot.
- That fence is consumed **twice**: by the inner render's native PostProcessor
  (correct — into the toolbar container) AND by Obsidian's **section-level**
  native PostProcessor (`Gz.registerPostProcessor((e,t)=>{ n=e.findAll("code.language-mermaid"); if(n.length) Yz(t.containerEl,n) })`),
  which scans the whole section right after our processor returns and renders a
  **second, bare** diagram.

The section-level scan's timing is not controllable from a code-block processor,
so class-rename / depth-juggling patches are unreliable. The reference plugin
never double-renders because it never emits `code.language-mermaid` — it only uses
its own renderer. We apply the same invariant to System mode, using Obsidian's
own mermaid engine via the public `loadMermaid()` API.

## Goals / Non-Goals

**Goals:**
- System view renders with Obsidian's built-in mermaid engine (same visual style,
  full type support: timeline/gantt/mindmap/pie/…), with **zero** bundled mermaid.
- The plugin **never** emits a `code.language-mermaid` node, so Obsidian's
  PostProcessor has nothing to scan — the double-render is eliminated by
  construction, in Reading View and Live Preview, first pass and rebuild.
- System render failures (syntax errors) surface in our `renderError` box, like
  Beautiful failures.

**Non-Goals:**
- Bundling the mermaid npm package.
- Using `MarkdownRenderer.render` for mermaid (dropped entirely).
- Changing the toggle UI, mode memory, per-type defaults/buttons, or the Beautiful
  path.

## Decisions

### D1 — System renders via `loadMermaid()` + `mermaid.render`, SVG injected
`renderSystemInto(slot, source)` becomes:
```
const mermaid = await this.loadMermaidOnce();
const { svg } = await mermaid.render(this.nextSystemId(), source);
appendSvg(slot, svg);   // DOMParser + importNode + appendChild (existing helper)
```
- `loadMermaid()` is a public Obsidian export (`obsidian.d.ts`, peer of
  `loadMathJax`/`loadPrism`); its impl returns Obsidian's own mermaid instance.
- The mermaid instance is cached on the plugin (`private mermaidInstance?: Promise<any>`),
  so `loadMermaid()` runs at most once.
- `mermaid.render(id, source)` returns `{ svg }`. `id` must be unique per call
  (mermaid uses it as a transient DOM id) → a monotonic counter
  (`abm-sys-${n++}`). Counter is fine because ids only need intra-session
  uniqueness.
- The returned `svg` is parsed with the existing `appendSvg` (DOMParser +
  `importNode` + `appendChild`) — never `innerHTML` (XSS-safe, matches the
  reference and Obsidian conventions).

*Alternative considered:* `MarkdownRenderer.render` + recreate-pre (current).
Rejected — it is the direct cause of the double-render (it must emit
`code.language-mermaid`, which the section-level PostProcessor double-consumes).

### D2 — Delete the re-entry machinery entirely
Remove `recreateNativeFence`, the `systemRenderDepth` field, and the
`if (this.systemRenderDepth > 0) …` branch in `handleMermaid`. They existed only
to feed Obsidian's PostProcessor; with `loadMermaid` there is no re-entry and no
recursion, so the guard is dead. `handleMermaid` now only ever mounts the
container (every block is still fully owned).

### D3 — No-double-render invariant (restated, stronger)
> **Invariant:** the plugin never inserts a `code.language-mermaid` element into
> the document. Both renderers it uses — beautiful-mermaid (Beautiful) and
> `loadMermaid().render` (System) — produce SVG that we inject directly. Obsidian's
> section-level mermaid PostProcessor therefore always finds zero matches in our
> blocks and can never draw a second diagram, in any pass or surface.

**Verification:** a unit assertion that, after a System render (mocked
`loadMermaid`), the slot contains the injected `<svg>` and **no**
`code.language-mermaid`; plus the existing "owned block exposes zero
`code.language-mermaid`" invariant tests (now true in System/Both too).

### D4 — Live Preview parity
`renderWidget`'s `renderSystem` callback uses the same `renderSystemInto`, so Live
Preview System rendering switches to `loadMermaid` automatically. The per-widget
`MarkdownRenderChild` lifecycle component is no longer needed for System (no
`MarkdownRenderer.render` to scope), but is harmless; it may be simplified.

### D5 — Async injection & ordering
`mermaid.render` is async. The System slot fills in after a tick (lazy + cached as
today). `ready` (the Reading-View await) still only tracks the eager Beautiful
render; System remains lazy. No re-entrancy or depth concerns remain.

## Risks / Trade-offs

- **[`loadMermaid()` availability]** It is a documented public export; if a future
  Obsidian removed it, System mode would error into the `renderError` box and
  Beautiful would still work. → Accepted; isolate the call in one method.
- **[`mermaid.render` API shape]** Returns `{ svg }` in Obsidian's bundled mermaid
  (verified in app.js: `b.sent().svg`). If a version returned a bare string we'd
  read `undefined`. → Mitigation: handle both (`typeof res === "string" ? res :
  res.svg`).
- **[`mermaid.render` global id / concurrency]** mermaid uses the id for a
  transient DOM node; concurrent renders need distinct ids → monotonic counter
  guarantees this. mermaid serializes internally; acceptable.
- **[jsdom tests]** `mermaid.render` can't run under jsdom → tests mock
  `loadMermaid` to return `{ render: async () => ({ svg }) }` and assert injection.
- **[SVG sizing/theming]** Obsidian's own pipeline adds some wrapper/sizing; our
  direct injection yields the raw mermaid SVG. → Acceptable (native engine, native
  look); revisit sizing only if visually off in manual check.

## Migration Plan

- Rewrite `renderSystemInto`; delete `recreateNativeFence`, `systemRenderDepth`,
  and the re-entry branch; add cached mermaid instance + id counter; add
  `loadMermaid` to the obsidian test mock; update tests.
- No persisted state; no manifest bump required by the mechanism. Rollback = revert.

## Open Questions

- None blocking. (System = `loadMermaid` direct render; delete re-entry machinery;
  errors → `renderError`; both surfaces.)
