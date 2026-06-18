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
- [x] 3.4 For unsupported types (depth 0): restore the no-plugin DOM via `el.replaceWith(<pre><code class="language-mermaid">{source}</code></pre>)` so native renders it at its original position (fallback: build the pre inside `el` if `el.replaceWith` is unsafe). Do NOT mount a controller for these types
- [x] 3.5 Register a `MarkdownRenderChild` via `ctx.addChild` for controller/render lifecycle cleanup

## 4. Live Preview path

- [x] 4.1 Update `MermaidEditorWidget.toDOM` to mount the same `MermaidBlockController` (reusing the mode store), with a `renderSystem` callback using `MarkdownRenderer.render`
- [x] 4.2 Keep the StateField filtering to supported types only; unsupported fences remain untouched (native LP widget handles them)
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
- [ ] 7.4 Unsupported type (e.g. gantt): no toggle bar, native render + native source toggle/error UI intact
- [ ] 7.5 **Unsupported-type native UX equivalence (hard gate, design D1):** compare against a no-plugin baseline — (a) gantt renders and its native source-toggle button works; (b) an intentionally-broken pie shows the native error fallback (message + source), not our error box; (c) `getSectionInfo`/`replaceCode`-dependent behavior is not mis-positioned. If any degrades, switch to the "do not take over unsupported types" fallback per D1
- [ ] 7.6 Light/dark theme: toggle bar and views follow theme

## 8. Build & finalize

- [ ] 8.1 `npm test` green; `npm run build` (tsc typecheck + esbuild) clean
- [ ] 8.2 Update README if user-facing behavior/screenshots change
