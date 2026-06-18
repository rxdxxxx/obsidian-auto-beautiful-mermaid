/**
 * Global test setup.
 *
 * Obsidian augments the DOM `HTMLElement` with helper methods (`createDiv`,
 * `createEl`) that don't exist in stock jsdom. src/main.ts relies on them to
 * build its render output, so we polyfill them here using real DOM operations.
 * This keeps the rendered markup inspectable with standard query APIs.
 */

interface DomElementInfo {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
}

function applyDomInfo(el: HTMLElement, info?: DomElementInfo | string): void {
  if (info == null) return;

  if (typeof info === "string") {
    el.className = info;
    return;
  }

  if (info.cls != null) {
    el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  }
  if (info.text != null) {
    el.textContent = info.text;
  }
  if (info.attr != null) {
    for (const [key, value] of Object.entries(info.attr)) {
      el.setAttribute(key, String(value));
    }
  }
}

function createEl(
  this: HTMLElement,
  tag: string,
  info?: DomElementInfo | string,
): HTMLElement {
  const child = document.createElement(tag);
  applyDomInfo(child, info);
  this.appendChild(child);
  return child;
}

function createDiv(
  this: HTMLElement,
  info?: DomElementInfo | string,
): HTMLDivElement {
  return createEl.call(this, "div", info) as HTMLDivElement;
}

// Patch the prototype so every element created under jsdom gains the helpers.
(HTMLElement.prototype as unknown as Record<string, unknown>).createEl = createEl;
(HTMLElement.prototype as unknown as Record<string, unknown>).createDiv = createDiv;
