## 1. Remove the re-entry / MarkdownRenderer machinery

- [x] 1.1 Delete `recreateNativeFence` and the `systemRenderDepth` field
- [x] 1.2 Remove the `if (this.systemRenderDepth > 0) { recreateNativeFence… }` branch from `handleMermaid` (it now always mounts the container)
- [x] 1.3 Drop the `MarkdownRenderer` import if no longer used; drop the per-widget `MarkdownRenderChild` System-lifecycle plumbing if it becomes dead (keep only if still needed)

## 2. loadMermaid-based System render

- [x] 2.1 Add `loadMermaid` to the `obsidian` imports and to `test/mocks/obsidian.ts`
- [x] 2.2 Add a cached mermaid instance on the plugin (`private mermaidInstance?: Promise<any>`) + a `loadMermaidOnce()` helper (calls `loadMermaid()` at most once)
- [x] 2.3 Add a monotonic unique-id source for `mermaid.render` ids (`abm-sys-${n++}`)
- [x] 2.4 Rewrite `renderSystemInto(slot, source)`: `const m = await loadMermaidOnce(); const res = await m.render(id, source); appendSvg(slot, typeof res === "string" ? res : res.svg)`; on throw → `renderError(slot, "system", error, source)`
- [x] 2.5 Verify `renderSystemInto` no longer takes/uses `sourcePath`/`component`; update its callers in `handleMermaid` and `renderWidget` accordingly

## 3. Tests (vitest, jsdom)

- [x] 3.1 Mock `loadMermaid` to return `{ render: async (id, src) => ({ svg: "<svg id=\"sys\">…</svg>" }) }`; assert the System slot receives the injected `<svg>` and contains no `code.language-mermaid`
- [x] 3.2 Assert `loadMermaid` is called at most once across two System renders (caching)
- [x] 3.3 Assert a rejecting `mermaid.render` renders the `.abm-error` box in the slot
- [x] 3.4 Remove obsolete tests: the `systemRenderDepth` re-entry-guard tests, the synchronous-throw-from-MarkdownRenderer test, and any assertion that System uses `MarkdownRenderer.render`
- [x] 3.5 Keep/adjust the no-double-render invariant tests so they assert zero `code.language-mermaid` after a System render too (unsupported timeline: container + one System svg, no bare node)

## 4. Artifacts & build

- [x] 4.1 `npm run build` (tsc + esbuild) clean; `npm test` green
- [x] 4.2 Update the `mermaid-render-mode-toggle` change's design/spec note (or this change's) so the System-mechanism description is consistent (loadMermaid, not recreate-pre)

## 5. Manual verification in Obsidian (real app)

- [ ] 5.1 Reading View: a `timeline` block shows exactly ONE diagram (native timeline in the System slot, with toolbar) — no bare second diagram
- [ ] 5.2 Reading View: a supported flowchart in Both mode shows Beautiful + one System diagram, no bare extra
- [ ] 5.3 Live Preview: same blocks, no double render
- [ ] 5.4 Malformed diagram in System → plugin error box (no crash, no bare native)
