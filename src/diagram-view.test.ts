import { describe, expect, it, vi } from "vitest";

import { DIAGRAM_VIEW_TYPE, DiagramView, type RenderInto } from "./diagram-view";

/** A renderer that drops a fixed SVG into the slot, like the plugin's render paths. */
function svgRenderer(svg = '<svg viewBox="0 0 300 150" width="100%"></svg>'): RenderInto {
  return vi.fn((slot: HTMLElement) => {
    slot.appendChild(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement);
    return Promise.resolve();
  });
}

/** setState's second argument; the view ignores it. */
const RESULT = { history: false };

function makeView(renderInto: RenderInto = svgRenderer()): DiagramView {
  return new DiagramView({} as never, renderInto);
}

describe("DiagramView", () => {
  it("identifies itself with the registered view type", () => {
    const view = makeView();
    expect(view.getViewType()).toBe(DIAGRAM_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("Mermaid diagram");
  });

  it("renders the saved source in the saved mode into a pan/zoom stage", async () => {
    const renderInto = svgRenderer();
    const view = makeView(renderInto);
    await view.setState({ source: "graph TD\n A-->B", mode: "system" }, RESULT);

    const stage = view.contentEl.querySelector<HTMLElement>(
      ".abm-diagram-viewport > .abm-diagram-stage",
    );
    expect(stage).not.toBeNull();
    const part = stage?.querySelector<HTMLElement>(".abm-diagram-part-system");
    expect(renderInto).toHaveBeenCalledTimes(1);
    expect(renderInto).toHaveBeenCalledWith(part, "graph TD\n A-->B", "system");
    expect(part?.querySelector("svg")).not.toBeNull();
    expect(view.contentEl.querySelector(".abm-pz-controls")).not.toBeNull();
  });

  it("in Both mode stacks Beautiful above System inside one zoom stage", async () => {
    const renderInto = svgRenderer();
    const view = makeView(renderInto);
    await view.setState({ source: "graph TD", mode: "both" }, RESULT);

    const stages = view.contentEl.querySelectorAll(".abm-diagram-stage");
    expect(stages).toHaveLength(1);
    const parts = Array.from(stages[0].querySelectorAll<HTMLElement>(":scope > .abm-diagram-part"));
    expect(parts.map((p) => p.className)).toEqual([
      "abm-diagram-part abm-diagram-part-beautiful",
      "abm-diagram-part abm-diagram-part-system",
    ]);
    expect(renderInto).toHaveBeenCalledWith(parts[0], "graph TD", "beautiful");
    expect(renderInto).toHaveBeenCalledWith(parts[1], "graph TD", "system");
    expect(stages[0].querySelectorAll("svg")).toHaveLength(2);
    expect(view.contentEl.querySelectorAll(".abm-pz-controls")).toHaveLength(1);
  });

  it("round-trips its state so Obsidian can restore the pane after a restart", async () => {
    const view = makeView();
    await view.setState({ source: "graph TD\n A-->B", mode: "beautiful" }, RESULT);
    expect(view.getState()).toEqual({ source: "graph TD\n A-->B", mode: "beautiful" });
  });

  it("gives the SVG its intrinsic viewBox size so it can be scaled freely", async () => {
    const view = makeView();
    await view.setState({ source: "graph TD", mode: "beautiful" }, RESULT);

    const svg = view.contentEl.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("300");
    expect(svg?.getAttribute("height")).toBe("150");
  });

  it("leaves an SVG without a viewBox untouched", async () => {
    const view = makeView(svgRenderer('<svg width="40" height="20"></svg>'));
    await view.setState({ source: "graph TD", mode: "beautiful" }, RESULT);

    const svg = view.contentEl.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.getAttribute("height")).toBe("20");
  });

  it("shows a placeholder and saves nothing when restored with invalid state", async () => {
    const renderInto = svgRenderer();
    const view = makeView(renderInto);
    await view.setState({ source: "graph TD", mode: "nope" }, RESULT);

    expect(renderInto).not.toHaveBeenCalled();
    expect(view.contentEl.querySelector(".abm-diagram-empty")?.textContent).toBe(
      "This diagram is no longer available.",
    );
    expect(view.getState()).toEqual({});
  });

  it("re-renders cleanly when given new state", async () => {
    const view = makeView();
    await view.setState({ source: "graph TD", mode: "beautiful" }, RESULT);
    await view.setState({ source: "graph LR", mode: "system" }, RESULT);

    expect(view.contentEl.querySelectorAll(".abm-diagram-viewport")).toHaveLength(1);
    expect(view.contentEl.querySelectorAll(".abm-pz-controls")).toHaveLength(1);
  });

  it("onClose tears down the viewer", async () => {
    const view = makeView();
    await view.setState({ source: "graph TD", mode: "beautiful" }, RESULT);
    await view.onClose();
    expect(view.contentEl.childElementCount).toBe(0);
  });
});