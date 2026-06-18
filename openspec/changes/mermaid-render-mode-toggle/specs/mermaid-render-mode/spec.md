## ADDED Requirements

### Requirement: Owned container for supported diagram types
The plugin SHALL render supported mermaid diagram types as a single owned
container holding a toggle bar and the diagram views, and SHALL take ownership of
the block before Obsidian's native mermaid PostProcessor can act on it. Supported
types are graph/flowchart, stateDiagram(-v2), sequenceDiagram, classDiagram,
erDiagram, and xychart(-beta).

#### Scenario: Supported type is taken over
- **WHEN** a `mermaid` fence whose first meaningful token is a supported type
  (graph/flowchart, stateDiagram(-v2), sequenceDiagram, classDiagram, erDiagram,
  xychart(-beta)) is rendered in Reading View
- **THEN** the plugin renders its container with a toggle bar
- **AND** the original `code.language-mermaid` node is no longer present in the
  block subtree, so Obsidian's native PostProcessor does not auto-render it

#### Scenario: Unsupported type is left to native
- **WHEN** a `mermaid` fence whose type is NOT supported (e.g. gantt, pie,
  mindmap, timeline) is rendered
- **THEN** the plugin does NOT add a toggle bar
- **AND** the block is rendered by Obsidian's native mermaid renderer, preserving
  its native source toggle and error UI

### Requirement: Four view modes
The container SHALL offer exactly four modes — Beautiful, System, Both, Source —
selectable from the toggle bar, with Beautiful as the default.

#### Scenario: Default mode
- **WHEN** a supported block is first rendered and has no remembered mode
- **THEN** the Beautiful view is shown and the Beautiful toggle is marked active

#### Scenario: Switch to System
- **WHEN** the reader selects System
- **THEN** only the native (System) render is visible and the Beautiful view is hidden

#### Scenario: Switch to Both
- **WHEN** the reader selects Both
- **THEN** the Beautiful view is shown stacked above the System view

#### Scenario: Switch to Source
- **WHEN** the reader selects Source
- **THEN** the raw mermaid fence text is shown as preformatted text
- **AND** that source view contains no element carrying the `language-mermaid` class

### Requirement: No double render invariant
At most one renderer SHALL produce visible output for a given block, determined
solely by the container's current mode. The native renderer SHALL NOT auto-render
a block the plugin owns, in the first render pass or in any invalidation-rebuild
pass.

#### Scenario: First pass, Beautiful mode
- **WHEN** the plugin owns a supported block and the mode is Beautiful
- **THEN** a scan for `code.language-mermaid` within the block finds zero nodes

#### Scenario: Rebuild pass is idempotent
- **WHEN** the same section is rebuilt (invalidation) and the plugin's code-block
  processor runs again over the rebuilt HTML
- **THEN** the plugin re-owns the block and a scan for `code.language-mermaid`
  again finds zero auto-renderable nodes outside an explicitly created System slot

#### Scenario: System output is confined to its slot
- **WHEN** the mode is System or Both
- **THEN** native mermaid output exists only inside the container's System slot,
  produced by the plugin's own controlled render, and nowhere else in the block

### Requirement: System view uses Obsidian's native renderer without a bundled engine
The System view SHALL be produced by `MarkdownRenderer.render` of a `mermaid`
fence, using a re-entry guard so Obsidian's native PostProcessor renders the
output inside the System slot. The plugin SHALL NOT bundle a separate mermaid
engine, and the re-entry guard SHALL NOT affect rendering of other blocks.

#### Scenario: System render produces native output
- **WHEN** the System view is rendered for the first time
- **THEN** the plugin calls `MarkdownRenderer.render` with a `mermaid` fence
- **AND** the re-entered code-block handler recreates a
  `<pre><code class="language-mermaid">` inside its element so the native
  PostProcessor renders it into the slot

#### Scenario: Re-entry guard does not leak
- **WHEN** a System render completes
- **THEN** the plugin's re-entry depth flag is zero
- **AND** a subsequent supported block renders its full owned container (not the
  recreate-pre passthrough)

#### Scenario: Lazy and cached
- **WHEN** a block stays in Beautiful mode
- **THEN** no System render is performed
- **AND WHEN** System or Both is selected the System render runs once and is reused
  on later switches

### Requirement: Per-block session mode memory
The plugin SHALL remember each block's chosen mode for the session in a map keyed
by the fence source text, so editing unrelated content does not reset a block's
mode. Mode SHALL NOT persist across note reopen.

#### Scenario: Mode survives unrelated edit
- **WHEN** a block is set to System and the user edits unrelated text causing the
  Live Preview widget or Reading View section to rebuild
- **THEN** the rebuilt block restores System mode

#### Scenario: Mode resets on reopen
- **WHEN** the note is closed and reopened
- **THEN** every block starts in Beautiful mode

### Requirement: Consistent toggle interaction in both surfaces
Both Reading View and Live Preview SHALL present the same four-mode toggle bar and
honor the same mode memory, styled to follow the active Obsidian theme.

#### Scenario: Live Preview toggle
- **WHEN** a supported fence is shown as a widget in Live Preview (cursor outside
  the fence)
- **THEN** the widget shows the toggle bar and switching modes behaves as in
  Reading View

#### Scenario: Theme-following styling
- **WHEN** the Obsidian theme is light or dark
- **THEN** the toggle bar and views use Obsidian CSS variables so they match the
  active theme
