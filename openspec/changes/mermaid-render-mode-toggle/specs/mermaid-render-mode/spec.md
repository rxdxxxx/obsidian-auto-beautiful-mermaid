## ADDED Requirements

### Requirement: Complete takeover of every mermaid block
The plugin SHALL render EVERY `mermaid` code block as a single owned container,
taking ownership before Obsidian's native mermaid PostProcessor can act on it.
No mermaid block — supported or unsupported — SHALL be left to Obsidian's native
auto-rendering.

#### Scenario: Supported type is taken over
- **WHEN** a `mermaid` fence of a supported type (graph/flowchart,
  stateDiagram(-v2), sequenceDiagram, classDiagram, erDiagram, xychart(-beta)) is
  rendered in Reading View
- **THEN** the plugin renders its container with a toolbar
- **AND** the original `code.language-mermaid` node is no longer present in the
  block subtree, so Obsidian's native PostProcessor does not auto-render it

#### Scenario: Unsupported type is also taken over
- **WHEN** a `mermaid` fence of an unsupported type (e.g. gantt, pie, mindmap,
  timeline) is rendered
- **THEN** the plugin renders its container with a toolbar (it is NOT left to
  Obsidian's native auto-rendering)
- **AND** no `code.language-mermaid` node remains in the block subtree outside an
  explicitly created System slot

### Requirement: Per-type default mode and button set
The container SHALL offer the modes appropriate to the block's diagram type and
default accordingly: supported types offer all four modes (Beautiful, System,
Both, Source) defaulting to Beautiful; unsupported types offer only System and
Source defaulting to System. Buttons for unavailable modes SHALL NOT be created
(not merely disabled), and the Beautiful view SHALL NOT be rendered for an
unsupported type.

#### Scenario: Supported default and buttons
- **WHEN** a supported block is first rendered with no remembered mode
- **THEN** the Beautiful view is shown, its toolbar button is marked active
- **AND** the toolbar shows Beautiful, System, Both, and Source buttons

#### Scenario: Unsupported default and buttons
- **WHEN** an unsupported block is first rendered with no remembered mode
- **THEN** the System view is the active mode
- **AND** the toolbar shows only System and Source buttons (no Beautiful/Both)
- **AND** the Beautiful renderer is never invoked for that block

#### Scenario: Switch to Both
- **WHEN** the reader selects Both on a supported block
- **THEN** the Beautiful view is shown stacked above the System view

#### Scenario: Switch to Source
- **WHEN** the reader selects Source
- **THEN** the raw mermaid fence text is shown as preformatted text
- **AND** that source view contains no element carrying the `language-mermaid` class

#### Scenario: Remembered mode is clamped to the type's allowed set
- **WHEN** a remembered mode is not offered by the block's type (e.g. a stale
  Beautiful for an unsupported type)
- **THEN** the block falls back to the type's default mode instead of honoring it

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
- **WHEN** a supported block stays in Beautiful mode
- **THEN** no System render is performed
- **AND WHEN** System or Both is selected the System render runs once and is reused
  on later switches

#### Scenario: Native errors surface in the System slot
- **WHEN** an unsupported block contains a malformed diagram (e.g. a broken pie)
- **THEN** its System slot shows Obsidian's native mermaid error UI (since the
  System slot renders through the native engine), not the plugin's own error box

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
- **THEN** every block starts in its type default (Beautiful for supported types,
  System for unsupported types)

### Requirement: Consistent toggle interaction in both surfaces
Both Reading View and Live Preview SHALL present the same toolbar (with the
type-appropriate button set) and honor the same mode memory, styled to follow the
active Obsidian theme. Live Preview SHALL decorate every mermaid fence (supported
and unsupported), not only supported ones.

#### Scenario: Live Preview toggle
- **WHEN** any mermaid fence is shown as a widget in Live Preview (cursor outside
  the fence)
- **THEN** the widget shows the toolbar and switching modes behaves as in
  Reading View

#### Scenario: Theme-following styling
- **WHEN** the Obsidian theme is light or dark
- **THEN** the toggle bar and views use Obsidian CSS variables so they match the
  active theme

### Requirement: Toolbar is revealed on hover or focus
The toolbar SHALL be hidden by default and revealed when the pointer hovers the
block or keyboard focus is within it, without shifting the diagram's layout.

#### Scenario: Hidden until hover
- **WHEN** the pointer is not over a block and focus is elsewhere
- **THEN** the toolbar is not visible (hidden via opacity/visibility, not display,
  so the diagram does not reflow when it appears)

#### Scenario: Revealed on hover
- **WHEN** the pointer hovers over the block container
- **THEN** the toolbar fades in over the block (absolutely positioned, top-right)
  without displacing the diagram content

#### Scenario: Reachable by keyboard
- **WHEN** keyboard focus moves into the block (focus-within)
- **THEN** the toolbar is visible so a keyboard user can operate the buttons
