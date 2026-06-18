import { editorLivePreviewField, MarkdownPostProcessorContext, Plugin } from "obsidian";
import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import mermaid from "mermaid";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Diagram type keywords that beautiful-mermaid fully supports.
 * Everything else is routed to the official mermaid.js engine.
 *
 * Compared lowercased against the first token of a code block.
 */
const BEAUTIFUL_SUPPORTED = new Set<string>([
  "graph",
  "flowchart",
  "statediagram",
  "statediagram-v2",
  "sequencediagram",
  "classdiagram",
  "erdiagram",
  "xychart",
  "xychart-beta",
]);

/**
 * Priority for our code block processor. beautiful-mermaid-renderer registers
 * its mermaid processor at -100; a smaller (more negative) value runs earlier,
 * so -200 lets us intercept and route before any other plugin.
 */
const PROCESSOR_PRIORITY = -200;

/** CSS variables passed to beautiful-mermaid so diagrams follow the Obsidian theme. */
const BEAUTIFUL_OPTIONS = {
  bg: "var(--background-primary)",
  fg: "var(--text-normal)",
  transparent: true,
} as const;

export default class AutoBeautifulMermaidPlugin extends Plugin {
  /** Monotonic id source for unique mermaid render targets. */
  private renderSeq = 0;

  async onload(): Promise<void> {
    // startOnLoad must be false — we drive rendering manually per code block.
    mermaid.initialize({ startOnLoad: false });

    // Reading View: Obsidian's post-processor pipeline.
    this.registerMarkdownCodeBlockProcessor(
      "mermaid",
      (source, el, ctx) => this.handleMermaid(source, el, ctx),
      PROCESSOR_PRIORITY,
    );

    // Live Preview: a CodeMirror editor extension that replaces mermaid fences
    // with rendered widgets while the cursor is outside them.
    this.registerEditorExtension(createMermaidEditorExtension(this));
  }

  private async handleMermaid(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    const diagramType = extractDiagramType(source);

    if (diagramType !== null && BEAUTIFUL_SUPPORTED.has(diagramType)) {
      await this.renderWithBeautiful(source, el);
    } else {
      await this.renderWithOfficial(source, el);
    }
  }

  /** Render via beautiful-mermaid. On any error: show error + source, no fallback. */
  private async renderWithBeautiful(source: string, el: HTMLElement): Promise<void> {
    try {
      // beautiful-mermaid maps bg/fg onto the SVG's own --bg/--fg custom
      // properties, which resolve against the theme at paint time, so the
      // diagram follows light/dark.
      const svg = await renderMermaidSVGAsync(source, { ...BEAUTIFUL_OPTIONS });

      const container = el.createDiv({ cls: "abm-container abm-beautiful" });
      appendSvg(container, svg);
    } catch (error) {
      renderError(el, "beautiful-mermaid", error, source);
    }
  }

  /** Render via official mermaid.js. On any error: show error + source, no fallback. */
  private async renderWithOfficial(source: string, el: HTMLElement): Promise<void> {
    try {
      // Follow Obsidian's light/dark mode for the official engine.
      const theme = document.body.classList.contains("theme-dark") ? "dark" : "default";
      mermaid.initialize({ startOnLoad: false, theme });

      const id = `abm-mermaid-${this.renderSeq++}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);

      const container = el.createDiv({ cls: "abm-container abm-official" });
      appendSvg(container, svg);
      if (bindFunctions) {
        bindFunctions(container);
      }
    } catch (error) {
      renderError(el, "mermaid.js", error, source);
    }
  }

  /**
   * Render a single fence into a freshly-created Live Preview widget host.
   *
   * The beautiful-mermaid path is synchronous (`renderMermaidSVG`) because a
   * WidgetType's `toDOM()` must return immediately. The official mermaid.js
   * path is asynchronous, so it paints a placeholder first and fills the SVG in
   * once the promise settles.
   */
  renderWidget(source: string): HTMLElement {
    const host = document.createElement("div");
    const diagramType = extractDiagramType(source);

    if (diagramType !== null && BEAUTIFUL_SUPPORTED.has(diagramType)) {
      try {
        const svg = renderMermaidSVG(source, { ...BEAUTIFUL_OPTIONS });
        const container = host.createDiv({ cls: "abm-container abm-beautiful" });
        appendSvg(container, svg);
      } catch (error) {
        renderError(host, "beautiful-mermaid", error, source);
      }
    } else {
      const container = host.createDiv({ cls: "abm-container abm-official" });
      container.createDiv({ cls: "abm-loading", text: "Rendering diagram…" });
      void this.fillOfficialWidget(source, container);
    }

    return host;
  }

  /** Asynchronously render the official engine into an already-mounted widget host. */
  private async fillOfficialWidget(source: string, container: HTMLElement): Promise<void> {
    try {
      const theme = document.body.classList.contains("theme-dark") ? "dark" : "default";
      mermaid.initialize({ startOnLoad: false, theme });

      const id = `abm-mermaid-${this.renderSeq++}`;
      const { svg, bindFunctions } = await mermaid.render(id, source);

      container.replaceChildren();
      appendSvg(container, svg);
      if (bindFunctions) {
        bindFunctions(container);
      }
    } catch (error) {
      container.replaceChildren();
      renderError(container, "mermaid.js", error, source);
    }
  }
}

/**
 * Extract the diagram-type keyword from a mermaid code block.
 *
 * Skips YAML frontmatter (`---` … `---`), directive lines (`%%{...}%%` / `%%`),
 * and blank lines, then returns the lowercased first whitespace-delimited token
 * of the first meaningful line (e.g. "flowchart TD" -> "flowchart",
 * "stateDiagram-v2" -> "statediagram-v2"). Returns null if nothing is found.
 */
export function extractDiagramType(source: string): string | null {
  const lines = source.split("\n");
  let inFrontmatter = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) continue;

    // YAML frontmatter block.
    if (line === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    // Directive / comment lines (init configs, etc.).
    if (line.startsWith("%%")) continue;

    // First meaningful line: the diagram declaration.
    const firstToken = line.split(/\s+/)[0];
    return firstToken.toLowerCase();
  }

  return null;
}

/**
 * Parse an SVG string and append it to `host` as a real DOM node.
 *
 * Using DOMParser + importNode (rather than `innerHTML = svg`) avoids the HTML
 * parser's quirks with SVG/namespaced markup and keeps the node bound to the
 * host's owner document — which matters inside Obsidian's editor surfaces where
 * the host may live in a detached or foreign document context.
 *
 * Throws if the parsed root is not an `<svg>` element.
 */
export function appendSvg(host: HTMLElement, svg: string): void {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svg, "image/svg+xml");
  const svgElement = parsed.documentElement;

  if (svgElement.nodeName.toLowerCase() !== "svg") {
    throw new Error("Mermaid renderer returned invalid SVG");
  }

  const doc = host.ownerDocument ?? document;
  host.appendChild(doc.importNode(svgElement, true));
}

/** Render an error box with the engine name, the error message, and the raw source. */
export function renderError(
  el: HTMLElement,
  engine: string,
  error: unknown,
  source: string,
): void {
  const message = error instanceof Error ? error.message : String(error);

  const box = el.createDiv({ cls: "abm-error" });
  box.createDiv({
    cls: "abm-error-title",
    text: `Auto Beautiful Mermaid — ${engine} failed to render this diagram`,
  });
  box.createDiv({ cls: "abm-error-message", text: message });

  const pre = box.createEl("pre");
  pre.createEl("code", { text: source });
}

/** A located mermaid fenced code block within the editor document. */
export interface MermaidFence {
  /** Document offset of the opening fence line. */
  from: number;
  /** Document offset just past the closing fence line. */
  to: number;
  /** The mermaid source between the fences (declaration + body). */
  source: string;
}

/**
 * Scan raw document text for fenced ```mermaid code blocks.
 *
 * Recognises both backtick and tilde fences and requires the closing fence to
 * use the same marker character as the opener. Returns one entry per block with
 * its document range and inner source, in document order.
 */
export function findMermaidFences(docText: string): MermaidFence[] {
  const fences: MermaidFence[] = [];
  // Leading indentation is spaces/tabs only — `\s*` would greedily swallow the
  // preceding newline and push `from` onto the wrong line.
  const fencePattern = /^([ \t]*)(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]+)?[^\n\r]*$/gm;
  let opening: { from: number; marker: string } | null = null;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(docText)) != null) {
    const marker = match[2] ?? "";
    const language = (match[3] ?? "").toLowerCase();
    const lineEnd = docText.indexOf("\n", match.index);
    const afterLine = lineEnd === -1 ? docText.length : lineEnd + 1;

    if (!opening) {
      if (language === "mermaid") {
        opening = { from: match.index, marker: marker[0] ?? "`" };
      }
      continue;
    }

    // A closing fence must use the same marker character as its opener.
    if ((marker[0] ?? "`") !== opening.marker) continue;

    const sourceStart = docText.indexOf("\n", opening.from);
    const source =
      sourceStart === -1
        ? ""
        : docText.slice(sourceStart + 1, match.index).replace(/\n$/, "");

    fences.push({ from: opening.from, to: afterLine, source });
    opening = null;
  }

  return fences;
}

/** Whether any selection range overlaps the [from, to] document span. */
export function selectionIntersects(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** WidgetType that renders a mermaid fence inside the Live Preview editor. */
class MermaidEditorWidget extends WidgetType {
  constructor(
    private readonly plugin: AutoBeautifulMermaidPlugin,
    private readonly source: string,
  ) {
    super();
  }

  eq(other: MermaidEditorWidget): boolean {
    return this.source === other.source;
  }

  toDOM(): HTMLElement {
    return this.plugin.renderWidget(this.source);
  }

  ignoreEvent(): boolean {
    // Let clicks through so the user can place the cursor and reveal the source.
    return false;
  }
}

/**
 * Build the StateField that decorates mermaid fences with rendered widgets in
 * Live Preview. A fence is left as plain source whenever a selection range
 * intersects it, so editing the block shows the underlying code.
 */
export function createMermaidEditorExtension(
  plugin: AutoBeautifulMermaidPlugin,
): StateField<DecorationSet> {
  const buildDecorations = (state: EditorState): DecorationSet => {
    // Only act in Live Preview; the legacy source mode has no widgets.
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    const docText = state.doc.toString();

    for (const fence of findMermaidFences(docText)) {
      if (selectionIntersects(state, fence.from, fence.to)) continue;

      builder.add(
        fence.from,
        fence.from,
        Decoration.widget({
          block: true,
          side: -1,
          widget: new MermaidEditorWidget(plugin, fence.source),
        }),
      );
      builder.add(fence.from, fence.to, Decoration.replace({ block: true }));
    }

    return builder.finish();
  };

  return StateField.define<DecorationSet>({
    create: buildDecorations,
    update: (_decorations, transaction) => buildDecorations(transaction.state),
    provide: (stateField) => EditorView.decorations.from(stateField),
  });
}
