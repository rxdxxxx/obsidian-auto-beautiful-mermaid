# Auto Beautiful Mermaid

English | [中文](README_CN.md)

An [Obsidian](https://obsidian.md) plugin that takes over every `mermaid` code block and lets you render it with whichever engine looks best — per block, or as a vault-wide default.

Three renderers, one toolbar:

| Renderer | What it is | Coverage |
|----------|-----------|----------|
| **Beautiful** | [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) — polished, theme-aware SVG built for looks | 6 types |
| **Pele** | [pele](https://github.com/obsidianmd/pele) — Obsidian's own Mermaid renderer: synchronous, no runtime dependencies, colors from CSS variables | 22 types |
| **System** | Obsidian's built-in Mermaid engine | everything Mermaid supports |

Both Reading View and Live Preview are covered, and the plugin guarantees a single render per fence — no duplicates.

## Features

- ✅ Three interchangeable renderers, switchable per diagram from a hover toolbar
- ✅ Vault-wide **default renderer** setting
- ✅ Full Mermaid type coverage — no diagram ever falls through to an error box
- ✅ Pele renders types beautiful-mermaid cannot draw (gantt, pie, mindmap, timeline, …)
- ✅ Automatic light/dark adaptation for every renderer
- ✅ Open in new window: pop the current view (Beautiful, Pele, System, or All stacked) out into its own window, with wheel/pinch zoom, drag to pan, and double-click to fit (opens as a tab on mobile)
- ✅ Live Preview support (CodeMirror EditorExtension)
- ✅ Zero conflicts — completely owns all `mermaid` fences

## Toolbar modes

Hover a rendered block to reveal its toolbar. Buttons appear only for renderers that can draw that diagram:

| Button | Shows |
|--------|-------|
| **Beautiful** | beautiful-mermaid output |
| **Pele** | pele output |
| **System** | Obsidian's native Mermaid output |
| **All** | Every renderer that supports this diagram, stacked — handy for comparing |
| **Source** | The raw fence |

Your choice is remembered for the session, keyed by the fence source. **Source** is always available, so you can always get back to the text.

## Choosing a default renderer

**Settings → Community Plugins → Auto Beautiful Mermaid → Default renderer.** New blocks start in the chosen renderer; the toolbar still overrides it per block. Changing the setting clears per-block choices and re-renders open views immediately.

A short guide:

- **Beautiful** (default) — best-looking output for flowcharts, sequence, state, class, ER, and XY charts. Picks this if most of your diagrams are in that set.
- **Pele** — much broader coverage and noticeably faster on large diagrams, at the cost of a simpler visual style (orthogonal edges, plainer class/ER boxes). Good when you write a lot of gantt/mindmap/timeline/pie.
- **System** — the reference implementation. Use it if you want exact Mermaid fidelity.

Types the chosen renderer cannot draw fall back to System automatically.

## Supported diagram types

| Type | Keyword | Beautiful | Pele |
|------|---------|:---------:|:----:|
| Flowchart | `flowchart` / `graph` | ✅ | ✅ |
| Sequence | `sequenceDiagram` | ✅ | ✅ |
| State | `stateDiagram` / `stateDiagram-v2` | ✅ | ✅ |
| Class | `classDiagram` | ✅ | ✅ |
| ER | `erDiagram` | ✅ | ✅ |
| XY chart | `xychart` / `xychart-beta` | ✅ | ✅ |
| Gantt | `gantt` | — | ✅ |
| Pie | `pie` | — | ✅ |
| Mindmap | `mindmap` | — | ✅ |
| Timeline | `timeline` | — | ✅ |
| User journey | `journey` | — | ✅ |
| Git graph | `gitGraph` | — | ✅ |
| Quadrant | `quadrantChart` | — | ✅ |
| Sankey | `sankey-beta` | — | ✅ |
| Block | `block-beta` | — | ✅ |
| Architecture | `architecture-beta` | — | ✅ |
| Kanban | `kanban` | — | ✅ |
| Radar | `radar-beta` | — | ✅ |
| Treemap | `treemap-beta` | — | ✅ |
| C4 | `C4Context` / `C4Container` / … | — | ✅ |
| Packet | `packet-beta` | — | ✅ |
| Requirement | `requirementDiagram` | — | ✅ |

Every type is available in **System** mode. Types unsupported by both Beautiful and Pele (for example `zenuml`) simply offer System and Source.

Pele follows Mermaid 12.1 syntax with its own layout and visual style; its coverage grows release by release. This plugin bundles pele **1.12**, which adds character-level wrapping for Chinese and Japanese labels, wider inline HTML support, XML-safe SVG output, and readable labels on custom `style`/`classDef` fills in dark themes. Check [pele's issues](https://github.com/obsidianmd/pele/issues) for known rendering quirks before filing one here.

## Installation

### Community Plugin Store (recommended)

1. Open Obsidian Settings → Community Plugins → Browse
2. Search for **Auto Beautiful Mermaid**
3. Click Install, then Enable

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/rxdxxxx/obsidian-auto-beautiful-mermaid/releases/latest)
2. Copy them to `<vault>/.obsidian/plugins/auto-beautiful-mermaid/`
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Compatibility

- Minimum Obsidian version: **1.4.0**
- Conflicts with `beautiful-mermaid-renderer` — disable that plugin if both are installed
- Pele links: `click A "obsidian://..."` is allowed, so node links can open vault notes. `javascript:` and other unsafe schemes are dropped by pele itself

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm run test     # unit tests
npm run lint     # obsidianmd eslint rules
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for architecture details and the double-render root cause analysis.

## License

[MIT](LICENSE)
