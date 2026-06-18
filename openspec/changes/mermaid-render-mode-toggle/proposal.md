## Why

The plugin currently tries to *win* the render race against Obsidian's built-in
mermaid renderer: it renders supported diagrams with beautiful-mermaid, then
renames `code.language-mermaid` so Obsidian's PostProcessor skips the block. In
Reading View this still double-renders for supported types — the rename is a
no-op (Obsidian's code-block wrapper has already replaced the `<pre>` before our
async handler runs, so there is nothing left to rename), and on
invalidation-rebuild passes the native renderer draws the block a second time.
The fix is to stop fighting Obsidian and instead **own the block** and give the
reader an explicit toggle between renderers.

## What Changes

- Replace the "render then suppress native" strategy with an **owned container**:
  for the diagram types beautiful-mermaid supports, render a single container
  that holds a small toggle bar and up to four views of the same diagram.
- Four view modes per block: **Beautiful** (default), **System** (Obsidian's
  native mermaid render), **Both** (Beautiful stacked above System), **Source**
  (the raw mermaid fence text).
- The **System** view is produced by us via `MarkdownRenderer.render` of a
  `mermaid` fence, using a re-entry technique that lets Obsidian's native
  PostProcessor render genuinely-native output inside our container (no second
  mermaid engine bundled).
- Per-block mode is remembered for the session in a Map keyed by fence source,
  so editing unrelated text does not reset a block's chosen mode. Reopening the
  note resets to Beautiful.
- Both Reading View and Live Preview present the same toggle interaction.
- **Unsupported** mermaid types are unchanged: no toggle bar, passed straight to
  Obsidian's native renderer (keeping its native source toggle and error UI).
- **BREAKING (internal):** remove `neutralizeNativeMermaid` (the class-rename
  suppression) and the current `renderWithNative` delegation path; they are
  superseded by the owned container.

## Capabilities

### New Capabilities
- `mermaid-render-mode`: per-block multi-mode rendering of beautiful-mermaid
  supported diagrams — the Beautiful/System/Both/Source toggle, the toggle-bar
  UI, per-block session mode memory, and the no-double-render takeover guarantee
  across both Reading View and Live Preview.

### Modified Capabilities
<!-- None: there are no pre-existing OpenSpec specs in openspec/specs/. -->

## Impact

- **Code:** `src/main.ts` (processor registration, render routing, new container
  + toggle controller, System render via `MarkdownRenderer.render`, Live Preview
  widget); `styles.css` (toggle bar + view slots); `src/main.test.ts` (new unit
  coverage). Removal of `neutralizeNativeMermaid` and `renderWithNative`.
- **APIs/Obsidian internals relied on:** `registerMarkdownCodeBlockProcessor`
  sortOrder ordering vs the native mermaid PostProcessor (order 0);
  `MarkdownRenderer.render` running the full PostProcessor queue;
  `MarkdownPostProcessorContext.addChild` for lifecycle. No new npm dependencies.
- **Behavior:** every supported mermaid block gains a toggle bar; default visual
  output (Beautiful) is unchanged. Unsupported types are untouched.
