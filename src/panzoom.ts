import { setIcon } from "obsidian";

/**
 * Dependency-free pan & zoom for the pop-out diagram viewer.
 *
 * The stage element is moved with `translate(x, y) scale(k)` (origin top-left),
 * written as CSS custom properties so styles.css owns the actual `transform`.
 * The maths is kept in pure functions so it can be unit-tested without layout.
 */

/** A stage transform: screen = content × k + (x, y). */
export interface Transform {
  x: number;
  y: number;
  k: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

/** Zoom step for the +/− buttons. */
const BUTTON_ZOOM = 1.25;
/** Space kept around the diagram when fitting it to the viewport. */
const FIT_PADDING = 24;

const IDENTITY: Transform = { x: 0, y: 0, k: 1 };

export function clampScale(k: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
}

/**
 * Zoom by `factor` around viewport point (px, py), keeping the content point
 * under it fixed. The resulting scale is clamped to [MIN_SCALE, MAX_SCALE].
 */
export function zoomAt(t: Transform, factor: number, px: number, py: number): Transform {
  const k = clampScale(t.k * factor);
  if (k === t.k) return t;
  const ratio = k / t.k;
  return { x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio, k };
}

/**
 * The transform that fits content of the given size inside the viewport,
 * leaving `padding` on every side, centred. Identity when either size is
 * unknown (empty content, or a viewport that has not been laid out yet).
 */
export function fitTransform(
  contentW: number,
  contentH: number,
  viewW: number,
  viewH: number,
  padding = FIT_PADDING,
): Transform {
  const availW = viewW - 2 * padding;
  const availH = viewH - 2 * padding;
  if (contentW <= 0 || contentH <= 0 || availW <= 0 || availH <= 0) return IDENTITY;
  const k = clampScale(Math.min(availW / contentW, availH / contentH));
  return { x: (viewW - contentW * k) / 2, y: (viewH - contentH * k) / 2, k };
}

/** Handle returned by {@link attachPanZoom}. */
export interface PanZoomController {
  getTransform(): Transform;
  /** Fit the diagram to the viewport. */
  fit(): void;
  /** Re-fit after a viewport resize, unless the user has zoomed or panned. */
  refit(): void;
  /** Remove listeners and the zoom controls. */
  destroy(): void;
}

/**
 * Make `stage` (a child of `viewport`) zoomable with the wheel / trackpad pinch,
 * pannable by dragging, and fit-to-view on double-click. Adds a small control
 * overlay (− / % / + / Fit) to the viewport. Listeners live on the viewport
 * itself, so this works unchanged inside an Obsidian pop-out window.
 */
export function attachPanZoom(viewport: HTMLElement, stage: HTMLElement): PanZoomController {
  let transform = IDENTITY;
  // Until the user zooms or pans, the view keeps tracking the viewport size.
  let userMoved = false;
  let drag: { pointerId: number; x: number; y: number } | null = null;

  const controls = viewport.createDiv({ cls: "abm-pz-controls" });
  const button = (action: string, label: string, icon?: string): HTMLElement => {
    const el = controls.createEl("button", { cls: "abm-pz-btn", attr: { type: "button" } });
    el.dataset.action = action;
    el.setAttribute("aria-label", label);
    if (icon) setIcon(el, icon);
    else el.textContent = label;
    return el;
  };
  const zoomOut = button("zoom-out", "Zoom out", "minus");
  const scaleLabel = controls.createSpan({ cls: "abm-pz-scale" });
  const zoomIn = button("zoom-in", "Zoom in", "plus");
  const fitButton = button("fit", "Fit");

  // Whether an event started on the control overlay. Not `instanceof Element`:
  // in a pop-out window the DOM belongs to that window's realm, so the check
  // against the plugin's (main window) Element is always false.
  const onControls = (event: Event): boolean => event.composedPath().includes(controls);

  const apply = (next: Transform): void => {
    transform = next;
    stage.setCssProps({
      "--abm-pz-x": `${next.x}px`,
      "--abm-pz-y": `${next.y}px`,
      "--abm-pz-k": `${next.k}`,
    });
    scaleLabel.textContent = `${Math.round(next.k * 100)}%`;
  };

  const fit = (): void => {
    userMoved = false;
    apply(
      fitTransform(
        stage.offsetWidth,
        stage.offsetHeight,
        viewport.clientWidth,
        viewport.clientHeight,
      ),
    );
  };

  const zoomAround = (factor: number, px: number, py: number): void => {
    userMoved = true;
    apply(zoomAt(transform, factor, px, py));
  };
  const zoomCentre = (factor: number): void =>
    zoomAround(factor, viewport.clientWidth / 2, viewport.clientHeight / 2);

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    // Lines → pixels; trackpad pinch arrives as ctrl+wheel with small deltas.
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015));
    zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || onControls(event)) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.addClass("is-panning");
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = { ...drag, x: event.clientX, y: event.clientY };
    userMoved = true;
    apply({ ...transform, x: transform.x + dx, y: transform.y + dy });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    viewport.releasePointerCapture(event.pointerId);
    viewport.removeClass("is-panning");
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (onControls(event)) return;
    fit();
  };

  const onZoomIn = (): void => zoomCentre(BUTTON_ZOOM);
  const onZoomOut = (): void => zoomCentre(1 / BUTTON_ZOOM);

  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", onPointerUp);
  viewport.addEventListener("pointercancel", onPointerUp);
  viewport.addEventListener("dblclick", onDoubleClick);
  zoomIn.addEventListener("click", onZoomIn);
  zoomOut.addEventListener("click", onZoomOut);
  fitButton.addEventListener("click", fit);

  fit();

  return {
    getTransform: () => transform,
    fit,
    refit: () => {
      if (!userMoved) fit();
    },
    destroy: () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
      viewport.removeEventListener("dblclick", onDoubleClick);
      controls.remove();
    },
  };
}