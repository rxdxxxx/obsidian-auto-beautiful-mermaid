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

  addCommand(_command: unknown): unknown {
    // no-op
    return _command;
  }
}

/** Type-only export used by src/main.ts; erased at runtime. */
export type MarkdownPostProcessorContext = Record<string, unknown>;
