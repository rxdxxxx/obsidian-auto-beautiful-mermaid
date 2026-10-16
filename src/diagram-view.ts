import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";

import { attachPanZoom, type PanZoomController } from "./panzoom";

/** View type id registered with Obsidian's workspace. */
export const DIAGRAM_VIEW_TYPE = "abm-diagram";

/** Which engine draws the pop-out: beautiful-mermaid or Obsidian's own mermaid. */
export type DiagramRenderer = "beautiful" | "system";

/**
 * What the pane remembers. Obsidian persists it in `.obsidian/workspace.json`,
 * so a pop-out restored after a restart re-renders from the saved source —
 * a snapshot of the fence when it was opened, not a live link to the note.
 */
export interface DiagramViewState {
  source: string;
  renderer: DiagramRenderer;
}

/** Renders `source` with `renderer` into `slot`; surfaces its own errors in-slot. */
export type RenderInto = (
  slot: HTMLElement,
  source: string,
  renderer: DiagramRenderer,
) => Promise<void>;

function isDiagramViewState(state: unknown): state is DiagramViewState {
  if (typeof state !== "object" || state === null) return false;
  const { source, renderer } = state as Record<string, unknown>;
  return typeof source === "string" && (renderer === "beautiful" || renderer === "system");
}

/**
 * Pane showing one mermaid diagram with pan & zoom. Opened in a pop-out window
 * from a block's toolbar (see AutoBeautifulMermaidPlugin.openDiagram).
 */
export class DiagramView extends ItemView {
  private diagram: DiagramViewState | null = null;
  private panZoom?: PanZoomController;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly renderInto: RenderInto,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return DIAGRAM_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Mermaid diagram";
  }

  getIcon(): string {
    return "workflow";
  }

  getState(): Record<string, unknown> {
    return this.diagram ? { ...this.diagram } : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.diagram = isDiagramViewState(state)
      ? { source: state.source, renderer: state.renderer }
      : null;
    await this.draw();
    await super.setState(state, result);
  }

  onResize(): void {
    this.panZoom?.refit();
  }

  async onClose(): Promise<void> {
    this.teardown();
  }

  private teardown(): void {
    this.panZoom?.destroy();
    this.panZoom = undefined;
    this.contentEl.empty();
  }

  private async draw(): Promise<void> {
    this.teardown();
    if (!this.diagram) {
      this.contentEl.createDiv({
        cls: "abm-diagram-empty",
        text: "This diagram is no longer available.",
      });
      return;
    }

    const viewport = this.contentEl.createDiv({ cls: "abm-diagram-viewport" });
    const stage = viewport.createDiv({ cls: "abm-diagram-stage" });
    await this.renderInto(stage, this.diagram.source, this.diagram.renderer);
    for (const svg of Array.from(stage.querySelectorAll("svg"))) sizeToViewBox(svg);
    this.panZoom = attachPanZoom(viewport, stage);
  }
}

/**
 * Give an SVG its intrinsic viewBox size. Mermaid emits `width="100%"` (plus an
 * inline max-width), which collapses inside the shrink-to-fit stage; explicit
 * pixel dimensions let the stage measure the diagram and scale it freely.
 */
function sizeToViewBox(svg: SVGSVGElement): void {
  const box = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n))) return;
  const [, , width, height] = box;
  if (width <= 0 || height <= 0) return;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
}