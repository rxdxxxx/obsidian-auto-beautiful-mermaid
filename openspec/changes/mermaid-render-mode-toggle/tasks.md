## 1. Remove the suppression strategy

- [x] 1.1 Delete `neutralizeNativeMermaid` and its call site in `renderWithBeautiful`
- [x] 1.2 Delete the old `renderWithNative` delegation method
- [x] 1.3 Drop the obsolete `NATIVE_HOST_CLASS` re-entry marker (replaced by D3 depth flag)

## 2. Shared rendering core

- [x] 2.1 Add `ViewMode = "beautiful" | "system" | "both" | "source"` and a `DEFAULT_MODE = "beautiful"`
- [x] 2.2 Add exported `isSupportedType(source: string): boolean` built on `extractDiagramType` + `BEAUTIFUL_SUPPORTED` (unit-testable)
- [x] 2.3 Add exported `modeKey(source: string): string` (the Map key derivation) and a plugin-level `Map<string, ViewMode>` mode store with get/set helpers
- [x] 2.4 Implement `MermaidBlockController`: given `(host, source, renderSystem: (slot) => Promise<void>)`, build toggle bar + four slots (beautiful/system/both/source), wire mode switching via CSS visibility, read/write the mode store, lazy-render System on first need and cache it
- [x] 2.5 Build the toggle bar UI (segmented buttons, `aria-pressed`, keyboard focusable, Obsidian theme classes/vars); Source slot uses a neutral language class (never `language-mermaid`)

## 3. Reading View path

- [x] 3.1 Add a `systemRenderDepth` counter on the plugin (D3 re-entry guard)
- [x] 3.2 In `handleMermaid`: if `systemRenderDepth > 0`, recreate `<pre><code class="language-mermaid">{source}</code></pre>` inside `el` and return (passthrough for both System render and unsupported delegation)
- [x] 3.3 For supported types (depth 0): mount a `MermaidBlockController` in `el`; the `renderSystem` callback wraps `MarkdownRenderer.render(app, "```mermaid\n"+source+"\n```", slot, ctx.sourcePath ?? "", child)` with `systemRenderDepth++` before / `--` immediately after the call (before `await`)
- [x] 3.4 ~~For unsupported types: restore the no-plugin DOM and let native render~~ — **superseded by group 10**: unsupported types now also mount the container (default System)
- [x] 3.5 Register a `MarkdownRenderChild` via `ctx.addChild` for controller/render lifecycle cleanup

## 4. Live Preview path

- [x] 4.1 Update `MermaidEditorWidget.toDOM` to mount the same `MermaidBlockController` (reusing the mode store), with a `renderSystem` callback using `MarkdownRenderer.render`
- [x] 4.2 ~~Keep the StateField filtering to supported types only~~ — **superseded by group 10**: decorate every mermaid fence (supported and unsupported)
- [x] 4.3 Ensure `eq()` and the mode store keep mode stable across widget rebuilds from unrelated edits

## 5. Styling

- [x] 5.1 Add `styles.css` rules for the toggle bar (active/hover/focus states) and the four slots, using Obsidian CSS variables; Both stacks Beautiful above System

## 6. Tests (vitest, jsdom)

- [x] 6.1 `isSupportedType` / `modeKey` unit tests (supported vs unsupported types, key stability)
- [x] 6.2 Controller: default mode is Beautiful; switching shows/hides the right slots; Source slot has no `code.language-mermaid`
- [x] 6.3 Invariant test: a fake PP pipeline (our wrapper-equivalent removing the pre, then a stub native PP doing `findAll("code.language-mermaid")`) finds zero owned nodes in Beautiful mode, and exactly one only inside the System slot when System/Both is active — assert identically on a simulated first-pass AND rebuild-pass (idempotence)
- [x] 6.4 Re-entry guard test: after a (mocked) System render, `systemRenderDepth === 0`, and a following supported block builds the full container (not the passthrough)
- [x] 6.5 Lazy System: System render callback is not invoked while mode stays Beautiful; invoked once and cached on switch
- [x] 6.6 Mode memory: setting a mode then re-mounting a controller with the same source restores the mode
- [x] 6.7 Extend `test/mocks/obsidian.ts` as needed (MarkdownRenderer.render spy, MarkdownRenderChild, createDiv helpers) without over-mocking

## 7. Manual verification in Obsidian (real app)

- [ ] 7.1 Reading View: supported block shows toggle; Beautiful default; no double render; switch through all 4 modes
- [ ] 7.2 Reading View rebuild: scroll away/back, edit nearby text, toggle a frontmatter field → confirm still single render and mode honored where applicable
- [ ] 7.3 Live Preview: toggle works; editing unrelated text preserves mode; entering the fence shows source
- [ ] 7.4 Unsupported type (e.g. gantt): container WITH toolbar, default System, only System+Source buttons; renders natively in the System slot
- [ ] 7.5 **Native errors in System slot (revised gate, design D1):** a malformed unsupported diagram (e.g. broken pie) shows Obsidian's NATIVE error UI inside its System slot — not the plugin's `.abm-error` box. (Old equivalence-delegation gate is moot; we no longer delegate.)
- [ ] 7.6 Light/dark theme: toolbar and views follow theme
- [ ] 7.7 No multi-render: a note with many mermaid blocks (mixed supported/unsupported) shows exactly one rendering per block in both Reading View and Live Preview

## 8. Build & finalize

- [x] 8.1 `npm test` green (59 passing); `npm run build` (tsc typecheck + esbuild) clean
- [x] 8.2 Update README if user-facing behavior/screenshots change — N/A, repo tracks no README

## 9. Toolbar hover reveal (toggle-UI enhancement)

- [x] 9.1 Rename the bar to `.abm-toolbar` / `.abm-toolbar-btn` (was `.abm-toggle*`) in main.ts + styles.css
- [x] 9.2 `.abm-block` position:relative; `.abm-toolbar` absolute top-right, lifted out of flow (no reflow on show/hide)
- [x] 9.3 Hidden by default (opacity:0 + visibility:hidden, not display), revealed on `.abm-block:hover` and `.abm-block:focus-within`, with an opacity transition
- [x] 9.4 Verified by build + existing tests (class rename touches no test selectors); applies to both Reading View and Live Preview via shared CSS

## 10. Complete takeover + per-type default mode & button set (D1 flip)

- [x] 10.1 `handleMermaid`: remove the unsupported-type `restoreNativeFence` branch; always mount the container (keep the `systemRenderDepth>0 → recreateNativeFence` re-entry guard)
- [x] 10.2 Delete `restoreNativeFence` (no longer used); keep `recreateNativeFence`
- [x] 10.3 Add exported `defaultModeFor(source)` (supported→beautiful, else→system) and `allowedModes(source)` (supported→4 modes, else→[system, source])
- [x] 10.4 `plugin.getMode`: default via `defaultModeFor`, clamp a remembered mode to the type's allowed set
- [x] 10.5 `mountMermaidBlock`: take `modes`, create only offered buttons + reachable slots; render Beautiful eagerly only when offered (no wasted throw for unsupported)
- [x] 10.6 Live Preview `buildDecorations`: drop the `if(!isSupportedType) continue` — decorate every mermaid fence
- [x] 10.7 Tests: defaultModeFor/allowedModes/getMode clamp; unsupported mounts container (System default, System+Source buttons, no Beautiful render); update LP + routing tests; 64 passing
- [x] 10.8 Update design D1, spec, tasks to reflect the flip; `npm run build` + `npm test` green
