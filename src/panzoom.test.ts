import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachPanZoom,
  clampScale,
  fitTransform,
  MAX_SCALE,
  MIN_SCALE,
  zoomAt,
  type PanZoomController,
} from "./panzoom";

// --- Pure transform maths ------------------------------------------------------

describe("clampScale", () => {
  it("keeps a scale within [MIN_SCALE, MAX_SCALE]", () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe("zoomAt", () => {
  it("keeps the content point under the cursor fixed", () => {
    const before = { x: 10, y: 20, k: 1 };
    const after = zoomAt(before, 2, 110, 120);
    // Content point under (110,120) before: ((110-10)/1, (120-20)/1) = (100,100).
    expect(after.k).toBe(2);
    expect((110 - after.x) / after.k).toBeCloseTo(100);
    expect((120 - after.y) / after.k).toBeCloseTo(100);
  });

  it("returns the same transform when already at the scale limit", () => {
    const atMax = { x: 5, y: 5, k: MAX_SCALE };
    expect(zoomAt(atMax, 2, 50, 50)).toEqual(atMax);
  });

  it("clamps the resulting scale", () => {
    expect(zoomAt({ x: 0, y: 0, k: 1 }, 1e-6, 0, 0).k).toBe(MIN_SCALE);
  });
});

describe("fitTransform", () => {
  it("scales the content to fit inside the padded view and centres it", () => {
    // Available: 400x200 → k = min(400/200, 200/100) = 2; content becomes 400x200.
    expect(fitTransform(200, 100, 448, 248, 24)).toEqual({ x: 24, y: 24, k: 2 });
  });

  it("centres along the axis with slack", () => {
    // Available 400x400 → k = min(2, 4) = 2 → content 400x200, centred vertically.
    expect(fitTransform(200, 100, 448, 448, 24)).toEqual({ x: 24, y: 124, k: 2 });
  });

  it("returns the identity transform for empty content or an unlaid-out view", () => {
    expect(fitTransform(0, 0, 400, 400)).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitTransform(200, 100, 0, 0)).toEqual({ x: 0, y: 0, k: 1 });
  });

  it("clamps the fit scale", () => {
    expect(fitTransform(100000, 100000, 448, 448, 24).k).toBe(MIN_SCALE);
  });
});

// --- DOM controller --------------------------------------------------------------

/** jsdom has no layout: give the viewport and stage fixed measurements. */
function layout(
  el: HTMLElement,
  dims: { clientWidth?: number; clientHeight?: number; offsetWidth?: number; offsetHeight?: number },
): void {
  for (const [key, value] of Object.entries(dims)) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
}

let controller: PanZoomController | undefined;

/** Viewport 448x248 showing a 200x100 stage; fit transform is {24, 24, 2}. */
function setup(): {
  viewport: HTMLElement;
  stage: HTMLElement;
  pz: PanZoomController;
  capture: ReturnType<typeof vi.fn>;
} {
  const viewport = document.createElement("div");
  const stage = viewport.createDiv();
  layout(viewport, { clientWidth: 448, clientHeight: 248 });
  layout(stage, { offsetWidth: 200, offsetHeight: 100 });
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  const capture = vi.fn();
  viewport.setPointerCapture = capture;
  viewport.releasePointerCapture = vi.fn();
  controller = attachPanZoom(viewport, stage);
  return { viewport, stage, pz: controller, capture };
}

function pointer(type: string, init: { x: number; y: number; button?: number }): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    button: init.button ?? 0,
    pointerId: 1,
  });
}

function control(viewport: HTMLElement, action: string): HTMLElement {
  const button = viewport.querySelector<HTMLElement>(`.abm-pz-controls [data-action="${action}"]`);
  if (!button) throw new Error(`no ${action} control`);
  return button;
}

afterEach(() => {
  controller?.destroy();
  controller = undefined;
});

describe("attachPanZoom", () => {
  it("fits the stage to the viewport on attach and writes the transform to CSS props", () => {
    const { stage, pz } = setup();
    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 2 });
    expect(stage.style.getPropertyValue("--abm-pz-x")).toBe("24px");
    expect(stage.style.getPropertyValue("--abm-pz-y")).toBe("24px");
    expect(stage.style.getPropertyValue("--abm-pz-k")).toBe("2");
  });

  it("wheel zooms around the cursor and prevents page scroll", () => {
    const { viewport, pz } = setup();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: 124,
      clientY: 74,
    });
    viewport.dispatchEvent(event);

    const t = pz.getTransform();
    expect(event.defaultPrevented).toBe(true);
    expect(t.k).toBeGreaterThan(2);
    // Content point under (124,74) stays (50,25).
    expect((124 - t.x) / t.k).toBeCloseTo(50);
    expect((74 - t.y) / t.k).toBeCloseTo(25);
  });

  it("dragging with the primary button pans by the pointer delta", () => {
    const { viewport, pz, capture } = setup();
    viewport.dispatchEvent(pointer("pointerdown", { x: 100, y: 100 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 130, y: 90 }));
    viewport.dispatchEvent(pointer("pointerup", { x: 130, y: 90 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 300, y: 300 }));

    expect(pz.getTransform()).toEqual({ x: 54, y: 14, k: 2 });
    expect(capture).toHaveBeenCalledWith(1);
  });

  it("ignores non-primary buttons and presses on the controls", () => {
    const { viewport, pz } = setup();
    viewport.dispatchEvent(pointer("pointerdown", { x: 100, y: 100, button: 2 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 150, y: 150 }));
    control(viewport, "zoom-in").dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 200, y: 200 }));

    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 2 });
  });

  it("zoom buttons zoom around the viewport centre and update the percentage", () => {
    const { viewport, pz } = setup();
    control(viewport, "zoom-in").click();
    const zoomed = pz.getTransform();
    expect(zoomed.k).toBeGreaterThan(2);
    // Centre (224,124) maps to content (100,50) before and after.
    expect((224 - zoomed.x) / zoomed.k).toBeCloseTo(100);
    expect(viewport.querySelector(".abm-pz-scale")?.textContent).toBe(
      `${Math.round(zoomed.k * 100)}%`,
    );

    control(viewport, "zoom-out").click();
    expect(pz.getTransform().k).toBeCloseTo(2);
  });

  it("the fit button and double-click restore the fitted view", () => {
    const { viewport, pz } = setup();
    viewport.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 50, y: 50 }));
    viewport.dispatchEvent(pointer("pointerup", { x: 50, y: 50 }));

    control(viewport, "fit").click();
    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 2 });

    viewport.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    viewport.dispatchEvent(pointer("pointermove", { x: 50, y: 50 }));
    viewport.dispatchEvent(pointer("pointerup", { x: 50, y: 50 }));
    viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 2 });
  });

  it("refit() follows viewport resizes until the user zooms or pans", () => {
    const { viewport, pz } = setup();
    layout(viewport, { clientWidth: 248, clientHeight: 148 });
    pz.refit();
    // Available 200x100 → k = 1, centred.
    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 1 });

    control(viewport, "zoom-in").click();
    const userView = pz.getTransform();
    layout(viewport, { clientWidth: 448, clientHeight: 248 });
    pz.refit();
    expect(pz.getTransform()).toEqual(userView);
  });

  it("destroy() removes the controls and stops reacting to input", () => {
    const { viewport, pz } = setup();
    pz.destroy();
    controller = undefined;
    viewport.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }),
    );

    expect(viewport.querySelector(".abm-pz-controls")).toBeNull();
    expect(pz.getTransform()).toEqual({ x: 24, y: 24, k: 2 });
  });
});