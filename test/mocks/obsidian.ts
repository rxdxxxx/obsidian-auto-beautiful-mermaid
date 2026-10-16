/**
 * Minimal mock of the `obsidian` module for unit tests.
 *
 * The real `obsidian` package ships type declarations plus a runtime that only
 * exists inside the Electron app, so it cannot be imported under jsdom. We only
 * need the surface that src/main.ts touches: the `Plugin` base class. Its
 * lifecycle hooks are no-ops here — the tests call the plugin's render methods
 * directly rather than going through Obsidian's processor registration.
 */

export class Plugin {
  app: unknown;
  manifest: unknown;

  constructor(app?: unknown, manifest?: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  registerMarkdownCodeBlockProcessor(
    _language: string,
    _handler: (...args: unknown[]) => unknown,
    _sortOrder?: number,
  ): void {
    // no-op
  }

  registerEditorExtension(_extension: unknown): void {
    // no-op
  }

  addCommand(_command: unknown): unknown {
    // no-op
    return _command;
  }

  registerView(_type: string, _factory: (leaf: unknown) => unknown): void {
    // no-op
  }
}

/**
 * Mock of Obsidian's `Platform`. Tests flip `isDesktopApp` to exercise the
 * pop-out (desktop) versus tab (mobile) branch; reset it in `afterEach`.
 */
export const Platform = { isDesktopApp: true, isMobile: false };

/** Mock of `setIcon`: records the icon id so tests can assert which was set. */
export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.dataset.icon = iconId;
}

/** Type-only exports used by src/diagram-view.ts; erased at runtime. */
export type ViewStateResult = Record<string, unknown>;
export type WorkspaceLeaf = Record<string, unknown>;

/**
 * Minimal `ItemView`: Obsidian builds `containerEl` with a `contentEl` child
 * before calling `onOpen`. Lifecycle hooks are no-ops; tests call them directly.
 */
export class ItemView {
  app: unknown;
  leaf: unknown;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf: unknown) {
    this.leaf = leaf;
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
  }

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(_state: unknown, _result: ViewStateResult): Promise<void> {
    // no-op
  }

  onResize(): void {
    // no-op
  }
}

/** Type-only export used by src/main.ts; erased at runtime. */
export type MarkdownPostProcessorContext = Record<string, unknown>;

/**
 * Mock of Obsidian's `loadMermaid()`. src/main.ts renders the System view by
 * `loadMermaid()` then `mermaid.render(id, source)`. Tests control the render
 * result via `__setMermaidRender` and inspect load count via `__loadMermaidCalls`.
 */
const DEFAULT_RENDER = async (): Promise<{ svg: string }> => ({
  svg: '<svg data-mermaid="system"></svg>',
});
let mermaidRenderImpl: (id: string, source: string) => Promise<{ svg?: string } | string> =
  DEFAULT_RENDER;
let loadMermaidCalls = 0;
let loadFailures = 0;

export function loadMermaid(): Promise<unknown> {
  loadMermaidCalls += 1;
  if (loadFailures > 0) {
    loadFailures -= 1;
    return Promise.reject(new Error("loadMermaid failed"));
  }
  return Promise.resolve({
    render: (id: string, source: string) => mermaidRenderImpl(id, source),
  });
}

/** Test helper: override the mermaid.render implementation. */
export function __setMermaidRender(
  fn: (id: string, source: string) => Promise<{ svg?: string } | string>,
): void {
  mermaidRenderImpl = fn;
}

/** Test helper: make the next N loadMermaid() calls reject. */
export function __failNextLoad(times = 1): void {
  loadFailures = times;
}

/** Test helper: how many times loadMermaid() has been invoked. */
export function __loadMermaidCalls(): number {
  return loadMermaidCalls;
}

/** Test helper: reset the mermaid mock between tests. */
export function __resetMermaid(): void {
  mermaidRenderImpl = DEFAULT_RENDER;
  loadMermaidCalls = 0;
  loadFailures = 0;
}

/**
 * Marker for the CodeMirror StateField that flags Live Preview mode. The real
 * value is a `StateField` supplied by Obsidian; src/main.ts only reads it via
 * `state.field(editorLivePreviewField, false)`, which tests never invoke, so a
 * placeholder object is enough to satisfy the named import.
 */
export const editorLivePreviewField = {} as unknown;
