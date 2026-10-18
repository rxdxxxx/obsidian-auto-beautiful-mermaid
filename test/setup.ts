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
  this: HTMLElement | undefined,
  tag: string,
  info?: DomElementInfo | string,
): HTMLElement {
  const child = document.createElement(tag);
  applyDomInfo(child, info);
  // Prototype calls (el.createEl) append to `this`; bare global calls (strict
  // mode → `this` undefined) mirror enhance.js's window.createEl, which leaves
  // the element detached unless info.parent says otherwise.
  this?.appendChild(child);
  return child;
}

function createDiv(
  this: HTMLElement,
  info?: DomElementInfo | string,
): HTMLDivElement {
  return createEl.call(this, "div", info) as HTMLDivElement;
}

function createSpan(
  this: HTMLElement,
  info?: DomElementInfo | string,
): HTMLSpanElement {
  return createEl.call(this, "span", info) as HTMLSpanElement;
}

function addClass(this: HTMLElement, ...classes: string[]): void {
  this.classList.add(...classes);
}

function removeClass(this: HTMLElement, ...classes: string[]): void {
  this.classList.remove(...classes);
}

/** Obsidian's `el.empty()`: remove every child. */
function empty(this: HTMLElement): void {
  while (this.firstChild) this.removeChild(this.firstChild);
}

/** Obsidian's `el.setCssProps()`: set CSS custom properties inline. */
function setCssProps(this: HTMLElement, props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
}

// Patch the prototype so every element created under jsdom gains the helpers.
(HTMLElement.prototype as unknown as Record<string, unknown>).createEl = createEl;
(HTMLElement.prototype as unknown as Record<string, unknown>).createDiv = createDiv;
(HTMLElement.prototype as unknown as Record<string, unknown>).createSpan = createSpan;
(HTMLElement.prototype as unknown as Record<string, unknown>).addClass = addClass;
(HTMLElement.prototype as unknown as Record<string, unknown>).removeClass = removeClass;
(HTMLElement.prototype as unknown as Record<string, unknown>).empty = empty;
(HTMLElement.prototype as unknown as Record<string, unknown>).setCssProps = setCssProps;

// Obsidian's ambient `activeDocument` global (obsidian.d.ts) is injected by the
// app at runtime — enhance.js defines it per focused window. Under jsdom there
// is one document; provide the global so bare references in src/main.ts resolve.
(globalThis as unknown as Record<string, unknown>).activeDocument = document;
// Same for the ambient createEl/createDiv/createFragment helpers (enhance.js
// defines them on window; no `parent` in the info → element stays detached,
// exactly the semantics src/main.ts relies on for CodeMirror widget hosts).
(globalThis as unknown as Record<string, unknown>).createEl = createEl;
(globalThis as unknown as Record<string, unknown>).createDiv = createDiv;
