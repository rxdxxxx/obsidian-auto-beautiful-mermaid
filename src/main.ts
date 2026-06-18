import { MarkdownPostProcessorContext, Plugin } from "obsidian";
import { renderMermaidSVGAsync } from "beautiful-mermaid";
import mermaid from "mermaid";

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

export default class AutoBeautifulMermaidPlugin extends Plugin {
  /** Monotonic id source for unique mermaid render targets. */
  private renderSeq = 0;

  async onload(): Promise<void> {
    // startOnLoad must be false — we drive rendering manually per code block.
    mermaid.initialize({ startOnLoad: false });

    this.registerMarkdownCodeBlockProcessor(
      "mermaid",
      (source, el, ctx) => this.handleMermaid(source, el, ctx),
      PROCESSOR_PRIORITY,
    );
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
      // Pass Obsidian CSS variables straight through: beautiful-mermaid maps
      // bg/fg onto the SVG's own --bg/--fg custom properties, which resolve
      // against the theme at paint time, so the diagram follows light/dark.
      const svg = await renderMermaidSVGAsync(source, {
        bg: "var(--background-primary)",
        fg: "var(--text-normal)",
        transparent: true,
      });

      const container = el.createDiv({ cls: "abm-container abm-beautiful" });
      // SVG comes from the trusted local render library (no remote input).
      container.innerHTML = svg;
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
      container.innerHTML = svg;
      if (bindFunctions) {
        bindFunctions(container);
      }
    } catch (error) {
      renderError(el, "mermaid.js", error, source);
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
function extractDiagramType(source: string): string | null {
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

/** Render an error box with the engine name, the error message, and the raw source. */
function renderError(
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
