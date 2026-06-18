## ADDED Requirements

### Requirement: System view renders via the loadMermaid API
The System view SHALL be produced by calling Obsidian's public `loadMermaid()`
API and `mermaid.render`, injecting the returned SVG into the System slot. The
plugin SHALL NOT use `MarkdownRenderer.render` for mermaid and SHALL NOT bundle a
separate mermaid engine. The `loadMermaid()` instance SHALL be loaded at most once
and cached.

#### Scenario: System render injects native SVG
- **WHEN** the System view is rendered for the first time
- **THEN** the plugin awaits `loadMermaid()`, calls `mermaid.render` with a unique
  id and the fence source, and injects the returned SVG into the System slot via
  DOM parsing + appendChild (not `innerHTML`)
- **AND** the System slot contains an `<svg>` element

#### Scenario: mermaid instance is cached
- **WHEN** two blocks render their System views
- **THEN** `loadMermaid()` is invoked at most once across the session

#### Scenario: System render failure shows an error box
- **WHEN** `mermaid.render` rejects (e.g. a malformed diagram)
- **THEN** the System slot shows the plugin's error box (engine, message, source),
  consistent with the Beautiful failure path

### Requirement: The plugin never emits code.language-mermaid
No rendering path SHALL insert a `code.language-mermaid` element into the
document. Both the Beautiful and System renderers SHALL inject pre-rendered SVG
directly, so Obsidian's section-level mermaid PostProcessor finds no match in any
owned block and cannot draw a second diagram.

#### Scenario: No native-scannable node after System render
- **WHEN** a block's System view has rendered (Reading View or Live Preview)
- **THEN** a scan of the block for `code.language-mermaid` finds zero elements
- **AND** only one diagram is visible for that block (no bare, toolbar-less copy)

#### Scenario: Holds in both surfaces and across rebuilds
- **WHEN** a section is re-rendered (invalidation/rebuild) or a Live Preview widget
  is rebuilt
- **THEN** the block still exposes zero `code.language-mermaid` nodes and renders
  exactly one diagram per active view

## REMOVED Requirements

### Requirement: System view uses Obsidian's native renderer without a bundled engine
**Reason**: The `MarkdownRenderer.render` + `recreateNativeFence` +
`systemRenderDepth` re-entry mechanism emitted a `code.language-mermaid` that
Obsidian's section-level PostProcessor independently scanned and rendered a second
time (Reading View double-render). It is replaced by the `loadMermaid()` direct
render above, which emits no native-scannable node.
**Migration**: None for users. Internally, `recreateNativeFence` and
`systemRenderDepth` are deleted; `renderSystemInto` now calls `loadMermaid()`.
