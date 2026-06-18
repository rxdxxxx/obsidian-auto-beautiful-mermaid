## Context

The plugin renders beautiful-mermaid for supported diagram types and previously
tried to suppress Obsidian's native renderer by renaming `code.language-mermaid`
after a successful render. Reverse-engineering Obsidian's `app.js` showed why
this is the wrong model:

- All markdown post-processors (PPs) live in **one array sorted ascending by
  `sortOrder`**. The native mermaid renderer is a PP registered with no sortOrder
  → effective order `0`. It does `findAll("code.language-mermaid")` then, per
  match, `codeNode.parentElement.replaceWith(renderedMermaidDiv)`.
- `registerMarkdownCodeBlockProcessor(lang, handler, sortOrder)` registers a PP
  in that *same* array. Its wrapper **synchronously** does
  `pre.replaceWith(ourDiv)` **before** calling our handler. So a code-block
  processor at `sortOrder < 0` removes `code.language-mermaid` from the subtree
  *before* the native PP (order 0) ever scans for it.
- Therefore the old class-rename was a no-op: by the time our `async` handler
  ran, the `<pre><code class="language-mermaid">` was already gone (replaced by
  our div), so there was nothing to rename. We were *already* winning the
  first-pass race; the residual double-render came from the
  **invalidation-rebuild** path (`rerender(true)`, frontmatter change, `clear()`)
  which rebuilds a section from its cached HTML string — still containing the
  original `<pre><code class="language-mermaid">` — and re-runs the full PP queue.
- `MarkdownRenderer.render(...)` runs the full PP queue over its markdown, so a
  ```` ```mermaid ```` fence handed to it is intercepted by *our own* code-block
  processor before native — naive delegation recurses.
- Obsidian's mermaid engine is a bundled module-local, **not** `window.mermaid`;
  plugins cannot invoke it directly. The only plugin-facing path to native output
  is `MarkdownRenderer.render`.
- Live Preview renders mermaid through a CodeMirror widget that hard-codes the
  built-in engine and never calls plugin code-block processors. Our registered
  `EditorExtension` StateField already fully controls supported fences there.

## Goals / Non-Goals

**Goals:**
- Each supported mermaid block renders as a single container with a themed toggle
  bar offering **Beautiful** (default), **System**, **Both**, **Source**.
- **No-double-render invariant** (see Decisions) holds in *both* the first
  section pass and every invalidation-rebuild pass, in Reading View and Live
  Preview. Native and Beautiful never both render visibly for the same block.
- The System view is genuinely Obsidian-native output, with no second mermaid
  engine added to the bundle.
- Per-block mode survives Live Preview widget rebuilds within a session (Map
  keyed by fence source); resets to Beautiful on note reopen.
- Unsupported mermaid types remain entirely untouched by this plugin.

**Non-Goals:**
- Persisting mode to disk or as a global setting.
- A toggle bar for unsupported diagram types.
- Bundling our own mermaid library.
- Changing which diagram types beautiful-mermaid supports (`BEAUTIFUL_SUPPORTED`).
- Cross-note or cross-session memory of modes.

## Decisions

### D1 — Own the block via a code-block processor (`sortOrder < 0`)
We keep `registerMarkdownCodeBlockProcessor("mermaid", handler, PROCESSOR_PRIORITY)`
with `PROCESSOR_PRIORITY = -200`. Because the wrapper replaces the `<pre>`
synchronously before the native PP (order 0) scans, this **deterministically
pre-empts native** in any pass — first render *and* rebuild — for blocks we
choose to handle. This is the structural basis of the no-double-render invariant.

For **unsupported** types the handler must still let native render, with **zero
degradation** of native UX (source-toggle button, error fallback, and the
`getSectionInfo`-dependent `replaceCode` behavior). The wrapper has *already*
removed the original `<pre>` by the time we run, so "doing nothing" would leave
an empty div. To keep the DOM **byte-for-byte equivalent to the no-plugin case**
(no extra nesting that could shift `getSectionInfo` line mapping or wrap the
native error UI), the handler **replaces our own wrapper div with a freshly built
`<pre><code class="language-mermaid">{source}</code></pre>** via
`el.replaceWith(pre)` — restoring the section to exactly the structure Obsidian
would have produced — then returns. The native PP (order 0, later in the same
loop) finds it at its original position and renders it identically to a vault
without this plugin. (Building the pre inside our div, rather than replacing the
div, is the fallback only if `el.replaceWith` proves unsafe with the wrapper's
bookkeeping.)

> **Equivalence gate (hard constraint):** the unsupported-type passthrough is
> only acceptable if native source-toggle, error fallback, and `replaceCode`/
> `getSectionInfo` behave **identically** to no-plugin. This MUST be verified
> (see tasks). If any native UX degrades or mis-positions, we **do not take over
> unsupported types at all** — restore the original `<pre>` and leave it, even
> if that costs structural cleanliness. Beautiful-supported types are unaffected
> either way.

This same recreate-pre primitive is reused for the System view (see D3); the
difference is the System view recreates *inside* a dedicated slot, where extra
nesting is intentional and native `replaceCode` is irrelevant.

*Alternative considered:* register a plain `registerMarkdownPostProcessor` and
manually orchestrate. Rejected — the code-block wrapper's deterministic, ordered
`pre.replaceWith` is exactly the pre-emption primitive we want, and re-implementing
it as a raw PP is more fragile.

### D2 — No-double-render invariant (explicit)
> **Invariant:** For any mermaid block, at most one renderer ever produces
> visible output, and which one is determined solely by our container's current
> mode. Specifically: in every PP pass over a section (first render and every
> rebuild), the `<pre><code class="language-mermaid">` that we take ownership of
> is removed by our code-block wrapper before the native PP scans, so the native
> PP never *auto*-renders a block we own. Native output appears only inside a
> System/Both slot that we explicitly created and only via our controlled
> `MarkdownRenderer.render` call (D3).

Why it holds on rebuild: invalidation rebuilds re-run the *whole* PP queue from
the cached HTML string. Our code-block processor is part of that queue at -200,
so it re-owns and re-pre-empts on every rebuild identically to the first pass.
The old failure mode (native drawing on rebuild) cannot occur because we never
relied on a post-hoc DOM mutation that a rebuild discards — we rely on processor
ordering, which is reapplied on every pass.

**Verification of the invariant** (see specs + tasks):
- Unit (vitest, jsdom): a fake PP pipeline that (a) runs our wrapper-equivalent
  then (b) a stub native PP doing `findAll("code.language-mermaid")` →
  asserts native finds **zero** owned nodes after our handler in Beautiful mode,
  and finds **exactly one** inside the System slot only when System/Both is
  active. Run the same assertion twice (simulated first-pass + rebuild) to prove
  idempotence.
- Unit: source-view and toggle DOM must contain **no** `code.language-mermaid`
  (Source uses a neutral language class) so a stray rebuild can never let native
  grab the Source view.
- Manual checklist in tasks for real Obsidian (Reading View scroll, edit-induced
  rebuild, frontmatter edit, Live Preview).

### D3 — System view via `MarkdownRenderer.render` + recreate-pre re-entry
To show native output we call
`MarkdownRenderer.render(app, "```mermaid\n"+source+"\n```", systemSlot, sourcePath, child)`.
Inside that call our own code-block processor is re-entered (it runs the full PP
queue). We detect re-entry via a depth flag on the plugin instance and, instead
of building a container, **recreate `<pre><code class="language-mermaid">{source}</code></pre>`**
inside the handler's div and return. The native PP (order 0) then renders it into
the slot. The flag is incremented immediately before the `MarkdownRenderer.render`
call and decremented immediately after it returns its promise — safe because the
PP loop inside `render` executes **synchronously** before the promise is returned
(verified in `app.js`), so the flag is only set during our own synchronous
re-entry and cannot leak to other blocks. We `await` the returned promise to know
native's async `mermaid.render` finished.

*Alternatives considered:*
- Bundle mermaid and call `mermaid.render` ourselves — rejected by the user to
  keep the bundle light (avoids re-adding ~the previously-removed dependency set)
  and because "System" should be *Obsidian's* render, not ours.
- Temporarily `unregisterPostProcessor` our PP around the render — rejected:
  global and racy across concurrently-rendering blocks.

### D4 — Lazy System rendering, cached per container
Beautiful renders eagerly (it is the default and cheap-ish). System renders
**lazily** on first switch to System or Both and is cached in the container.
Source is trivial text. This avoids paying native render cost for blocks the
reader never toggles.

### D5 — Per-block session mode memory (Map keyed by source)
A `Map<string, ViewMode>` on the plugin keyed by the fence source text records
the chosen mode. Reading View controllers and Live Preview widgets both read/write
it, so editing unrelated text (which rebuilds widgets/sections) preserves a
block's mode. The map is in-memory only; reopening the note starts fresh at
Beautiful. *Trade-off:* two blocks with identical source share a key and thus a
mode — acceptable and rare; documented.

### D6 — Toggle bar UI, theme-native
A compact segmented button group at the top of the container, styled with
Obsidian variables/classes (e.g. `clickable-icon`/`is-active` patterns, radii and
borders from `--background-modifier-border`, `--interactive-accent`). Switching
modes toggles slot visibility via CSS classes; it does not re-render Beautiful.
The bar is keyboard-focusable; active mode marked with `aria-pressed`.

### D7 — Shared rendering core for both surfaces
Factor a view-agnostic `MermaidBlockController` that, given a host element +
source + a "render system into host" callback, builds the toggle bar, the four
slots, wires mode switching, and reads/writes the mode Map. Reading View provides
a callback using `MarkdownRenderer.render`; Live Preview's widget `toDOM` provides
the same. Pure helpers (`extractDiagramType`, fence finding, mode-key, "should we
own this type") stay exported for unit tests, matching existing style.

## Risks / Trade-offs

- **[Reliance on internal PP ordering]** D1/D3 depend on our `sortOrder` (-200)
  running before native's 0 and on native still matching `code.language-mermaid`.
  → Mitigation: this is long-stable Obsidian behavior; isolate the assumption in
  one place; if it ever breaks, Beautiful mode still works and only System is
  affected. Document the assumption inline with the verified `app.js` evidence.
- **[`MarkdownRenderer.render` re-entry depth flag leakage]** If the PP loop were
  ever async-before-return, the flag could affect another block. → Mitigation:
  verified synchronous in `app.js`; decrement right after the call returns (not
  after `await`); add a unit test asserting the flag is 0 after a System render.
- **[`getSectionInfo`/sourcePath unavailable]** System render needs a sourcePath
  for link resolution. → Mitigation: pass `ctx.sourcePath ?? ""`; mermaid does not
  require it.
- **[Identical-source blocks share mode]** (D5) → Accepted; documented.
- **[Source view accidentally rendered by native]** if it carried
  `language-mermaid`. → Mitigation: Source view uses a neutral class; covered by a
  unit assertion (D2).
- **[Live Preview widget churn]** frequent rebuilds could fl/re-render System.
  → Mitigation: mode Map + cached System slot keyed by source; widget `eq()`
  already prevents rebuild when source unchanged.

## Migration Plan

- Remove `neutralizeNativeMermaid` and `renderWithNative`; replace
  `handleMermaid`'s branch with the owned-container path for supported types and
  the recreate-pre passthrough for unsupported types.
- No data migration (no persisted state). No manifest/version bump required by
  the mechanism itself (bump version per repo convention on release).
- Rollback: revert the change; previous behavior restored. No persisted artifacts
  to clean up.

## Open Questions

- None blocking. (Resolved with user: only-wrap-supported types; MarkdownRenderer
  recreate-pre for System; session Map keyed by source; Both = Beautiful above
  System.)
