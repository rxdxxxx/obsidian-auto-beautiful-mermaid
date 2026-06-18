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
}

/** Type-only export used by src/main.ts; erased at runtime. */
export type MarkdownPostProcessorContext = Record<string, unknown>;

/**
 * Minimal mock of `MarkdownRenderer`. src/main.ts delegates unsupported diagram
 * types to `MarkdownRenderer.render`; tests spy on this static method to assert
 * the routing decision. The default implementation is an inert resolved promise.
 */
export class MarkdownRenderer {
  static render(
    _app: unknown,
    _markdown: string,
    _el: HTMLElement,
    _sourcePath: string,
    _component: unknown,
  ): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Marker for the CodeMirror StateField that flags Live Preview mode. The real
 * value is a `StateField` supplied by Obsidian; src/main.ts only reads it via
 * `state.field(editorLivePreviewField, false)`, which tests never invoke, so a
 * placeholder object is enough to satisfy the named import.
 */
export const editorLivePreviewField = {} as unknown;
