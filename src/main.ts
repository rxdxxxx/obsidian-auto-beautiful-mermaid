import {
  editorLivePreviewField,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  Plugin,
} from "obsidian";
import type { Component } from "obsidian";
import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/**
 * Diagram type keywords that beautiful-mermaid fully supports.
 * Every other type is left to Obsidian's built-in mermaid renderer.
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
 * Priority for our code block processor. A smaller (more negative) value runs
 * earlier. Obsidian registers all post-processors in one array sorted ascending
 * by sortOrder; the native mermaid renderer is a post-processor with no sortOrder
 * (effective 0). Because the code-block wrapper synchronously replaces the
 * `<pre>` with our element *before* calling our handler, a sortOrder < 0
 * deterministically removes `code.language-mermaid` from the subtree before the
 * native post-processor (0) ever scans for it — in the first pass and in every
 * invalidation-rebuild pass. This ordering, not any post-hoc DOM mutation, is
 * what guarantees we are never double-rendered.
 */
const PROCESSOR_PRIORITY = -200;

/** CSS variables passed to beautiful-mermaid so diagrams follow the Obsidian theme. */
const BEAUTIFUL_OPTIONS = {
  bg: "var(--background-primary)",
  fg: "var(--text-normal)",
  transparent: true,
} as const;

/** The four ways a single mermaid block can be displayed. */
export type ViewMode = "beautiful" | "system" | "both" | "source";

/** Mode a freshly-rendered block starts in when nothing is remembered. */
export const DEFAULT_MODE: ViewMode = "beautiful";

/** Toggle-bar order, left to right. */
const MODE_ORDER: readonly ViewMode[] = ["beautiful", "system", "both", "source"];

/** Human labels shown on the toggle buttons. */
const MODE_LABELS: Record<ViewMode, string> = {
  beautiful: "Beautiful",
  system: "System",
  both: "Both",
  source: "Source",
};

export default class AutoBeautifulMermaidPlugin extends Plugin {
  /**
   * Per-block view mode, remembered for the session and keyed by fence source
   * (see {@link modeKey}). Survives Live Preview widget rebuilds and Reading View
   * section re-renders triggered by unrelated edits; reset to Beautiful when the
   * note (and thus the plugin's in-memory map) is reopened.
   *
   * Keying by source means two blocks with byte-identical source in the same note
   * share one entry, so they toggle together — an accepted, rare trade-off (no
   * positional id is available across both render surfaces). See design D5.
   */
  private readonly modeStore = new Map<string, ViewMode>();

  /**
   * Re-entry depth for {@link renderSystemInto}. While > 0 we are inside our own
   * `MarkdownRenderer.render` call and must NOT build another container — instead
   * we recreate a `<pre><code class="language-mermaid">` so Obsidian's native
   * post-processor renders genuinely-native output into the System slot.
   */
  private systemRenderDepth = 0;

  async onload(): Promise<void> {
    // Reading View: one processor for the `mermaid` fence language. Supported
    // types become an owned, toggleable container; unsupported types are restored
    // to plain `<pre><code class="language-mermaid">` so Obsidian's native
    // renderer handles them untouched (keeping its source toggle and error UI).
    this.registerMarkdownCodeBlockProcessor(
      "mermaid",
      (source, el, ctx) => this.handleMermaid(source, el, ctx),
      PROCESSOR_PRIORITY,
    );

    // Live Preview: a CodeMirror extension that replaces supported mermaid fences
    // with the same toggleable container while the cursor is outside them.
    this.registerEditorExtension(createMermaidEditorExtension(this));
  }

  /** Current remembered mode for a block, or the default. */
  getMode(source: string): ViewMode {
    return this.modeStore.get(modeKey(source)) ?? DEFAULT_MODE;
  }

  /** Remember a block's chosen mode for the session. */
  setMode(source: string, mode: ViewMode): void {
    this.modeStore.set(modeKey(source), mode);
  }

  /**
   * Reading View entry point for a `mermaid` fence.
   *
   * Order matters: the re-entry guard is checked first so that a System render
   * (which re-runs the full post-processor queue over a `mermaid` fence and
   * re-invokes this handler) does not recurse into building another container.
   */
  private async handleMermaid(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    // We are inside our own MarkdownRenderer.render: hand the fence to the native
    // post-processor by recreating it, then bail.
    if (this.systemRenderDepth > 0) {
      recreateNativeFence(el, source);
      return;
    }

    // Unsupported types: restore the no-plugin DOM and let native render it.
    if (!isSupportedType(source)) {
      restoreNativeFence(el, source);
      return;
    }

    // Supported types: mount the toggleable container.
    const child = typeof ctx.addChild === "function"
      ? new MarkdownRenderChild(el)
      : undefined;
    if (child) ctx.addChild(child);

    const { ready } = mountMermaidBlock({
      host: el,
      source,
      getMode: () => this.getMode(source),
      setMode: (mode) => this.setMode(source, mode),
      renderBeautiful: (slot) => this.renderBeautifulInto(slot, source),
      renderSystem: (slot) =>
        this.renderSystemInto(slot, source, ctx.sourcePath ?? "", child ?? this),
    });

    await ready;
  }

  /**
   * Render a single supported fence into a Live Preview widget host.
   *
   * The beautiful path is synchronous here (`renderMermaidSVG`) because a
   * WidgetType's `toDOM()` must return immediately; the System slot still renders
   * asynchronously and fills in when ready.
   *
   * Returns a `MarkdownRenderChild` bound to the host as the System render's
   * lifecycle component — loaded here and unloaded by the widget's `destroy()`,
   * so native render children are torn down when CodeMirror rebuilds the widget
   * (rather than leaking under the plugin until it unloads).
   */
  renderWidget(source: string): { host: HTMLElement; child: MarkdownRenderChild } {
    const host = document.createElement("div");
    const child = new MarkdownRenderChild(host);
    child.load();

    mountMermaidBlock({
      host,
      source,
      getMode: () => this.getMode(source),
      setMode: (mode) => this.setMode(source, mode),
      renderBeautiful: (slot) => this.renderBeautifulSyncInto(slot, source),
      renderSystem: (slot) => this.renderSystemInto(slot, source, "", child),
    });

    return { host, child };
  }

  /** Beautiful render for Reading View (async). Errors render in-slot, no fallback. */
  private async renderBeautifulInto(slot: HTMLElement, source: string): Promise<void> {
    try {
      appendBeautiful(slot, await renderMermaidSVGAsync(source, { ...BEAUTIFUL_OPTIONS }));
    } catch (error) {
      renderError(slot, "beautiful-mermaid", error, source);
    }
  }

  /** Beautiful render for Live Preview (synchronous). */
  private renderBeautifulSyncInto(slot: HTMLElement, source: string): void {
    try {
      appendBeautiful(slot, renderMermaidSVG(source, { ...BEAUTIFUL_OPTIONS }));
    } catch (error) {
      renderError(slot, "beautiful-mermaid", error, source);
    }
  }

  /**
   * Produce Obsidian's genuinely-native render into a slot via
   * `MarkdownRenderer.render`, using the {@link systemRenderDepth} re-entry guard.
   *
   * The post-processor loop inside `MarkdownRenderer.render` runs synchronously
   * before the returned promise, so the guard is only raised during our own
   * synchronous re-entry — we decrement it in `finally` immediately after the
   * call returns (NOT after `await`) so it can never leak to another block.
   */
  private async renderSystemInto(
    slot: HTMLElement,
    source: string,
    sourcePath: string,
    component: Component,
  ): Promise<void> {
    let promise: Promise<void>;
    this.systemRenderDepth++;
    try {
      promise = MarkdownRenderer.render(
        this.app,
        "```mermaid\n" + source + "\n```",
        slot,
        sourcePath,
        component,
      );
    } finally {
      this.systemRenderDepth--;
    }

    try {
      await promise;
    } catch (error) {
      renderError(slot, "system", error, source);
    }
  }
}

/**
 * Mount a toggleable mermaid block into `host`.
 *
 * Builds a toggle bar (Beautiful / System / Both / Source) above three view
 * slots. The Beautiful and Source views render eagerly; the System view renders
 * lazily on first switch to System or Both and is cached thereafter. Visibility
 * is driven entirely by the `data-mode` attribute on the container (see
 * styles.css) so switching modes never re-renders an already-built view.
 *
 * Returns the container plus a `ready` promise that resolves once the eager
 * Beautiful render settles — Reading View awaits it so tests and downstream
 * passes observe a populated slot; Live Preview ignores it.
 */
export function mountMermaidBlock(opts: MermaidBlockOptions): {
  container: HTMLElement;
  ready: Promise<void>;
} {
  const { host, source } = opts;

  const container = host.createDiv({ cls: "abm-block" });
  const bar = container.createDiv({ cls: "abm-toolbar" });
  const views = container.createDiv({ cls: "abm-views" });

  // Order matters for the "Both" mode, which stacks Beautiful above System.
  const beautifulSlot = views.createDiv({ cls: "abm-view abm-view-beautiful" });
  const systemSlot = views.createDiv({ cls: "abm-view abm-view-system" });
  const sourceSlot = views.createDiv({ cls: "abm-view abm-view-source" });

  // Source view: NEVER carries `language-mermaid`, so a stray rebuild can never
  // let the native post-processor render it.
  const pre = sourceSlot.createEl("pre");
  pre.createEl("code", { cls: "abm-source-code", text: source });

  // Beautiful eagerly; `ready` settles when it does. Never rejects — render
  // implementations surface their own failures into the slot (see renderError),
  // so a bare `await ready` in callers cannot raise an unhandled rejection.
  const ready = Promise.resolve(opts.renderBeautiful(beautifulSlot)).catch(() => undefined);

  let systemRendered = false;
  const ensureSystem = (): void => {
    if (systemRendered) return;
    systemRendered = true;
    void opts.renderSystem(systemSlot);
  };

  const buttons = new Map<ViewMode, HTMLElement>();

  const apply = (mode: ViewMode): void => {
    if (mode === "system" || mode === "both") ensureSystem();
    container.dataset.mode = mode;
    for (const [candidate, button] of buttons) {
      const active = candidate === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  for (const mode of MODE_ORDER) {
    const button = bar.createEl("button", {
      cls: "abm-toolbar-btn",
      text: MODE_LABELS[mode],
    });
    button.setAttribute("type", "button");
    button.dataset.mode = mode;
    button.addEventListener("click", () => {
      opts.setMode(mode);
      apply(mode);
    });
    buttons.set(mode, button);
  }

  apply(opts.getMode());

  return { container, ready };
}

/** Options for {@link mountMermaidBlock}. */
export interface MermaidBlockOptions {
  /** Element to render the block into. */
  host: HTMLElement;
  /** The mermaid fence source (declaration + body). */
  source: string;
  /** Read the block's current mode. */
  getMode: () => ViewMode;
  /** Persist the block's chosen mode. */
  setMode: (mode: ViewMode) => void;
  /** Fill the Beautiful slot. Called once, eagerly. May be async. */
  renderBeautiful: (slot: HTMLElement) => void | Promise<void>;
  /** Fill the System slot with native output. Called lazily, once. May be async. */
  renderSystem: (slot: HTMLElement) => void | Promise<void>;
}

/**
 * Whether beautiful-mermaid supports this fence's diagram type.
 *
 * Used to decide whether to take over a block (build the container) or restore
 * it to Obsidian's native renderer.
 */
export function isSupportedType(source: string): boolean {
  const type = extractDiagramType(source);
  return type !== null && BEAUTIFUL_SUPPORTED.has(type);
}

/** Key under which a block's mode is remembered: the trimmed fence source. */
export function modeKey(source: string): string {
  return source.trim();
}

/** Render an SVG string into a freshly-created `.abm-beautiful` container in `slot`. */
export function appendBeautiful(slot: HTMLElement, svg: string): void {
  const container = slot.createDiv({ cls: "abm-container abm-beautiful" });
  appendSvg(container, svg);
}

/**
 * Build a detached `<pre><code class="language-mermaid">{source}</code></pre>`.
 *
 * The `language-mermaid` class is the load-bearing contract with Obsidian's
 * native post-processor (it scans for `code.language-mermaid`), so it lives in
 * exactly one place — both {@link recreateNativeFence} and
 * {@link restoreNativeFence} build their fence here.
 */
function buildMermaidFence(doc: Document, source: string): HTMLPreElement {
  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.appendChild(code);
  return pre;
}

/**
 * Recreate a `<pre><code class="language-mermaid">` *inside* `host` so Obsidian's
 * native post-processor (which scans for `code.language-mermaid` later in the
 * same pass) renders it there. Used for the System slot during a re-entrant
 * `MarkdownRenderer.render`.
 */
export function recreateNativeFence(host: HTMLElement, source: string): void {
  host.appendChild(buildMermaidFence(host.ownerDocument ?? document, source));
}

/**
 * Restore the no-plugin DOM for an unsupported diagram type: replace our wrapper
 * element with a freshly built `<pre><code class="language-mermaid">` at the same
 * position, so Obsidian's native renderer processes it exactly as it would
 * without this plugin (preserving its source toggle, error fallback, and
 * `getSectionInfo`-dependent behavior). Falls back to appending inside `el` when
 * it has no parent (e.g. under test).
 */
export function restoreNativeFence(el: HTMLElement, source: string): void {
  const pre = buildMermaidFence(el.ownerDocument ?? document, source);

  if (el.parentElement) {
    el.replaceWith(pre);
  } else {
    el.appendChild(pre);
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
  /** Lifecycle component for this widget's System render; unloaded on destroy. */
  private child: MarkdownRenderChild | null = null;

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
    const { host, child } = this.plugin.renderWidget(this.source);
    this.child = child;
    return host;
  }

  destroy(): void {
    // Tear down the System render's native children when CodeMirror replaces or
    // removes this widget, instead of leaking them under the plugin lifecycle.
    this.child?.unload();
    this.child = null;
  }

  ignoreEvent(): boolean {
    // Let clicks through so the toggle buttons work and the cursor can be placed.
    return false;
  }
}

/**
 * Build the StateField that decorates supported mermaid fences with rendered
 * widgets in Live Preview. A fence is left as plain source whenever a selection
 * range intersects it, so editing the block shows the underlying code.
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
      // Only decorate types beautiful-mermaid supports; leave the rest as plain
      // fences so Obsidian's built-in Live Preview renderer handles them.
      if (!isSupportedType(fence.source)) continue;

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
