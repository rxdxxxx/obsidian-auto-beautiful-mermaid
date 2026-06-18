import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import { MarkdownRenderChild, MarkdownRenderer } from "obsidian";

import AutoBeautifulMermaidPlugin, {
  allowedModes,
  appendSvg,
  DEFAULT_MODE,
  defaultModeFor,
  extractDiagramType,
  findMermaidFences,
  isSupportedType,
  modeKey,
  mountMermaidBlock,
  renderError,
  type ViewMode,
} from "./main";

/** Full button set for a beautiful-mermaid supported type. */
const SUPPORTED_MODES: ViewMode[] = ["beautiful", "system", "both", "source"];
/** Button set for an unsupported type. */
const UNSUPPORTED_MODES: ViewMode[] = ["system", "source"];

// --- External dependency mocks -------------------------------------------------

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: vi.fn(),
  renderMermaidSVGAsync: vi.fn(),
}));

const renderBeautiful = renderMermaidSVGAsync as unknown as Mock;
const renderBeautifulSync = renderMermaidSVG as unknown as Mock;
const markdownRender = vi.spyOn(MarkdownRenderer, "render");

/** Build a fresh plugin instance for a render call. */
function makePlugin(): AutoBeautifulMermaidPlugin {
  // The mocked Plugin base class takes (app, manifest) and ignores them.
  return new AutoBeautifulMermaidPlugin({} as never, {} as never);
}

/** Reach the plugin's private members at runtime for white-box assertions. */
function internals(plugin: AutoBeautifulMermaidPlugin): {
  handleMermaid: (s: string, e: HTMLElement, c: unknown) => Promise<void>;
  renderSystemInto: (
    slot: HTMLElement,
    source: string,
    sourcePath: string,
    component: unknown,
  ) => Promise<void>;
  systemRenderDepth: number;
} {
  return plugin as unknown as never;
}

/** Drive a single mermaid code block through the plugin's Reading View router. */
async function route(
  plugin: AutoBeautifulMermaidPlugin,
  source: string,
  el: HTMLElement,
): Promise<void> {
  await internals(plugin).handleMermaid(source, el, { sourcePath: "note.md" });
}

/** A minimal mutable mode holder for direct controller tests. */
function modeHolder(initial: ViewMode = DEFAULT_MODE): {
  getMode: () => ViewMode;
  setMode: (m: ViewMode) => void;
  current: () => ViewMode;
} {
  let mode = initial;
  return { getMode: () => mode, setMode: (m) => (mode = m), current: () => mode };
}

beforeEach(() => {
  renderBeautiful.mockReset();
  renderBeautifulSync.mockReset();
  markdownRender.mockReset();
  markdownRender.mockResolvedValue(undefined);
});

// --- extractDiagramType --------------------------------------------------------

describe("extractDiagramType", () => {
  it.each([
    ["graph TD", "graph"],
    ["flowchart LR", "flowchart"],
    ["stateDiagram-v2", "statediagram-v2"],
    ["sequenceDiagram", "sequencediagram"],
    ["classDiagram", "classdiagram"],
    ["erDiagram", "erdiagram"],
    ["xychart-beta", "xychart-beta"],
  ])("reads the lowercased type from %j", (source, expected) => {
    expect(extractDiagramType(source)).toBe(expected);
  });

  it("skips leading blank lines before the declaration", () => {
    expect(extractDiagramType("\n\n   \nflowchart TD\n  A --> B")).toBe("flowchart");
  });

  it("skips %% directive lines before the declaration", () => {
    const source = "%%{init: {'theme':'dark'}}%%\n%% a comment\nsequenceDiagram\n  A->>B: hi";
    expect(extractDiagramType(source)).toBe("sequencediagram");
  });

  it("skips a YAML frontmatter block before the declaration", () => {
    const source = "---\ntitle: My Diagram\nconfig:\n  theme: forest\n---\ngraph LR\n  X --> Y";
    expect(extractDiagramType(source)).toBe("graph");
  });

  it("returns null for an empty string", () => {
    expect(extractDiagramType("")).toBeNull();
  });

  it("returns null when only comments and blank lines are present", () => {
    expect(extractDiagramType("\n%% just a comment\n   \n%%{init: {}}%%\n")).toBeNull();
  });
});

// --- isSupportedType / modeKey -------------------------------------------------

describe("isSupportedType", () => {
  it.each([
    "graph TD\n A-->B",
    "flowchart LR\n A-->B",
    "stateDiagram\n [*]-->S",
    "stateDiagram-v2\n [*]-->S",
    "sequenceDiagram\n A->>B: hi",
    "classDiagram\n class A",
    "erDiagram\n A ||--o{ B : has",
    "xychart\n title T",
    "xychart-beta\n title T",
  ])("is true for supported type %j", (source) => {
    expect(isSupportedType(source)).toBe(true);
  });

  it.each(["gantt\n title G", "pie\n \"A\": 10", "timeline\n title T", "mindmap\n root"])(
    "is false for unsupported type %j",
    (source) => {
      expect(isSupportedType(source)).toBe(false);
    },
  );

  it("is false when no type can be extracted", () => {
    expect(isSupportedType("\n%% only a comment\n  \n")).toBe(false);
  });
});

describe("modeKey", () => {
  it("keys on the trimmed source so surrounding whitespace does not split a block", () => {
    expect(modeKey("  flowchart TD\n A-->B  ")).toBe("flowchart TD\n A-->B");
    expect(modeKey("flowchart TD\n A-->B")).toBe(modeKey("\nflowchart TD\n A-->B\n"));
  });
});

// --- Reading View routing (handleMermaid) --------------------------------------

describe("Reading View routing", () => {
  const SUPPORTED = "flowchart TD\n  A --> B";

  it("mounts a toggleable container for a supported type and renders Beautiful eagerly", async () => {
    renderBeautiful.mockResolvedValue("<svg id=\"ok\">x</svg>");
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, SUPPORTED, el);

    expect(el.querySelector(".abm-block")).not.toBeNull();
    expect(renderBeautiful).toHaveBeenCalledTimes(1);
    expect(el.querySelector(".abm-beautiful svg")).not.toBeNull();
    // System is lazy: not rendered until the reader switches to it.
    expect(markdownRender).not.toHaveBeenCalled();
  });

  it.each([
    ["gantt", "gantt\n  title A Gantt"],
    ["pie", "pie\n  title Pie\n  \"A\" : 10"],
    ["timeline", "timeline\n  title History"],
    ["mindmap", "mindmap\n  root((center))"],
  ])("owns unsupported type %s too: container, default System, no Beautiful/Both buttons", async (_label, source) => {
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, source, el);

    // Full takeover: a container is mounted (no delegation to native PP).
    const container = el.querySelector(".abm-block") as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.dataset.mode).toBe("system");
    // Beautiful is never invoked for unsupported types (no wasted throw).
    expect(renderBeautiful).not.toHaveBeenCalled();
    expect(el.querySelector(".abm-view-beautiful")).toBeNull();
    // Only System + Source buttons exist.
    const buttonModes = Array.from(el.querySelectorAll(".abm-toolbar-btn")).map(
      (b) => (b as HTMLElement).dataset.mode,
    );
    expect(buttonModes).toEqual(["system", "source"]);
    // System default → native render fired once into the System slot.
    expect(markdownRender).toHaveBeenCalledTimes(1);
  });

  it("owns a block with no extractable type (default System)", async () => {
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "\n%% only a comment\n   \n", el);

    expect((el.querySelector(".abm-block") as HTMLElement).dataset.mode).toBe("system");
    expect(renderBeautiful).not.toHaveBeenCalled();
    expect(markdownRender).toHaveBeenCalledTimes(1);
  });

  it("re-entry guard: while inside a System render it recreates the fence, not a container", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    const plugin = makePlugin();
    internals(plugin).systemRenderDepth = 1; // simulate being inside MarkdownRenderer.render
    const el = document.createElement("div");

    await route(plugin, SUPPORTED, el);

    expect(el.querySelector(".abm-block")).toBeNull();
    expect(el.querySelector("pre > code.language-mermaid")).not.toBeNull();
    expect(renderBeautiful).not.toHaveBeenCalled();
    expect(markdownRender).not.toHaveBeenCalled();
  });
});

// --- No-double-render invariant ------------------------------------------------

describe("no-double-render invariant", () => {
  const SUPPORTED = "flowchart TD\n  A --> B";

  /** Stand-in for Obsidian's native PP scan. */
  const nativeScanCount = (root: HTMLElement): number =>
    root.querySelectorAll("code.language-mermaid").length;

  it("an owned block in Beautiful mode exposes zero native-renderable nodes", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, SUPPORTED, el);

    expect(el.querySelector(".abm-block")).not.toBeNull();
    expect(nativeScanCount(el)).toBe(0);
    // Source view uses a neutral class, never language-mermaid.
    expect(el.querySelector(".abm-view-source code.abm-source-code")).not.toBeNull();
  });

  it("is idempotent: a rebuild pass yields the same zero-node result", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    const plugin = makePlugin();

    const first = document.createElement("div");
    await route(plugin, SUPPORTED, first);
    const second = document.createElement("div"); // simulate rebuild from cached HTML
    await route(plugin, SUPPORTED, second);

    expect(nativeScanCount(first)).toBe(0);
    expect(nativeScanCount(second)).toBe(0);
    expect(second.querySelector(".abm-block")).not.toBeNull();
  });

  it("native output is confined to the System slot when System mode is active", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    // Mock MarkdownRenderer.render to emulate native output landing in the slot.
    markdownRender.mockImplementation(async (_app, _md, slot) => {
      (slot as HTMLElement).createDiv({ cls: "mermaid" });
    });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, SUPPORTED, el);
    const systemBtn = el.querySelector('button[data-mode="system"]') as HTMLElement;
    systemBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    const systemSlot = el.querySelector(".abm-view-system") as HTMLElement;
    expect(systemSlot.querySelector(".mermaid")).not.toBeNull();
    // The native render is scoped to the slot, nowhere else.
    expect(el.querySelectorAll(".mermaid").length).toBe(1);
  });
});

// --- System render re-entry guard ----------------------------------------------

describe("renderSystemInto re-entry guard", () => {
  it("raises the depth flag only during the synchronous render call, then clears it", async () => {
    const plugin = makePlugin();
    let depthDuringCall = -1;
    markdownRender.mockImplementation(() => {
      depthDuringCall = internals(plugin).systemRenderDepth;
      return Promise.resolve();
    });
    const slot = document.createElement("div");

    await internals(plugin).renderSystemInto(slot, "flowchart TD\n A-->B", "note.md", plugin);

    expect(depthDuringCall).toBe(1);
    expect(internals(plugin).systemRenderDepth).toBe(0);
    expect(markdownRender).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("flowchart TD\n A-->B"),
      slot,
      "note.md",
      plugin,
    );
  });

  it("does not leak the flag: a later block still builds a full container", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    const plugin = makePlugin();
    const slot = document.createElement("div");
    await internals(plugin).renderSystemInto(slot, "flowchart TD\n A-->B", "n.md", plugin);

    const el = document.createElement("div");
    await route(plugin, "flowchart TD\n  A --> B", el);

    expect(el.querySelector(".abm-block")).not.toBeNull();
    expect(el.querySelector("code.language-mermaid")).toBeNull();
  });

  it("renders an error box in the slot when the System render rejects", async () => {
    const plugin = makePlugin();
    markdownRender.mockRejectedValue(new Error("system boom"));
    const slot = document.createElement("div");

    await internals(plugin).renderSystemInto(slot, "flowchart TD\n A-->B", "n.md", plugin);

    const errorBox = slot.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("system boom");
    expect(internals(plugin).systemRenderDepth).toBe(0);
  });

  it("renders an error box (and clears depth) on a SYNCHRONOUS throw from render", async () => {
    const plugin = makePlugin();
    markdownRender.mockImplementation(() => {
      throw new Error("sync system boom");
    });
    const slot = document.createElement("div");

    // Must not reject (no unhandled rejection); error is shown in-slot.
    await internals(plugin).renderSystemInto(slot, "pie\n title P", "n.md", plugin);

    const errorBox = slot.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("sync system boom");
    expect(internals(plugin).systemRenderDepth).toBe(0);
  });
});

// --- mountMermaidBlock controller ----------------------------------------------

describe("mountMermaidBlock", () => {
  const SOURCE = "flowchart TD\n  A --> B";

  it("defaults to Beautiful, renders it eagerly, and renders System lazily", async () => {
    const host = document.createElement("div");
    const renderB = vi.fn();
    const renderS = vi.fn();
    const mode = modeHolder();

    const { container, ready } = mountMermaidBlock({
      host,
      source: SOURCE,
      modes: SUPPORTED_MODES,
      getMode: mode.getMode,
      setMode: mode.setMode,
      renderBeautiful: renderB,
      renderSystem: renderS,
    });
    await ready;

    expect(container.dataset.mode).toBe("beautiful");
    expect(renderB).toHaveBeenCalledTimes(1);
    expect(renderS).not.toHaveBeenCalled();
    expect(
      (container.querySelector('button[data-mode="beautiful"]') as HTMLElement).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("switches modes: System renders once and is cached across later switches", () => {
    const host = document.createElement("div");
    const renderS = vi.fn();
    const mode = modeHolder();

    const { container } = mountMermaidBlock({
      host,
      source: SOURCE,
      modes: SUPPORTED_MODES,
      getMode: mode.getMode,
      setMode: mode.setMode,
      renderBeautiful: vi.fn(),
      renderSystem: renderS,
    });

    (container.querySelector('button[data-mode="system"]') as HTMLElement).click();
    expect(container.dataset.mode).toBe("system");
    expect(mode.current()).toBe("system");
    expect(renderS).toHaveBeenCalledTimes(1);

    (container.querySelector('button[data-mode="both"]') as HTMLElement).click();
    expect(container.dataset.mode).toBe("both");
    expect(renderS).toHaveBeenCalledTimes(1); // cached, not re-rendered

    (container.querySelector('button[data-mode="source"]') as HTMLElement).click();
    expect(container.dataset.mode).toBe("source");
  });

  it("the Source view carries no language-mermaid class", () => {
    const host = document.createElement("div");
    mountMermaidBlock({
      host,
      source: SOURCE,
      modes: SUPPORTED_MODES,
      getMode: () => "source",
      setMode: vi.fn(),
      renderBeautiful: vi.fn(),
      renderSystem: vi.fn(),
    });

    expect(host.querySelector(".abm-view-source code.abm-source-code")?.textContent).toBe(SOURCE);
    expect(host.querySelector("code.language-mermaid")).toBeNull();
  });

  it("restores a remembered mode on (re)mount, rendering System eagerly for Both", () => {
    const host = document.createElement("div");
    const renderS = vi.fn();

    const { container } = mountMermaidBlock({
      host,
      source: SOURCE,
      modes: SUPPORTED_MODES,
      getMode: () => "both",
      setMode: vi.fn(),
      renderBeautiful: vi.fn(),
      renderSystem: renderS,
    });

    expect(container.dataset.mode).toBe("both");
    expect(renderS).toHaveBeenCalledTimes(1);
  });

  it("for an unsupported modes set: no Beautiful slot, no Beautiful render, only System/Source buttons", () => {
    const host = document.createElement("div");
    const renderB = vi.fn();
    const renderS = vi.fn();

    const { container } = mountMermaidBlock({
      host,
      source: "gantt\n  title G",
      modes: UNSUPPORTED_MODES,
      getMode: () => "system",
      setMode: vi.fn(),
      renderBeautiful: renderB,
      renderSystem: renderS,
    });

    expect(container.dataset.mode).toBe("system");
    expect(container.querySelector(".abm-view-beautiful")).toBeNull();
    expect(renderB).not.toHaveBeenCalled(); // never invoked → no wasted throw
    expect(renderS).toHaveBeenCalledTimes(1); // System default renders eagerly
    expect(
      Array.from(container.querySelectorAll(".abm-toolbar-btn")).map(
        (b) => (b as HTMLElement).dataset.mode,
      ),
    ).toEqual(["system", "source"]);
  });
});

// --- per-type default mode & button set ----------------------------------------

describe("defaultModeFor / allowedModes / getMode clamping", () => {
  it("supported types default to Beautiful and offer all four modes", () => {
    expect(defaultModeFor("flowchart TD\n A-->B")).toBe("beautiful");
    expect(allowedModes("flowchart TD\n A-->B")).toEqual([
      "beautiful",
      "system",
      "both",
      "source",
    ]);
  });

  it("unsupported types default to System and offer only System/Source", () => {
    expect(defaultModeFor("gantt\n title G")).toBe("system");
    expect(allowedModes("gantt\n title G")).toEqual(["system", "source"]);
  });

  it("getMode clamps a remembered mode to the type's allowed set", () => {
    const plugin = makePlugin();
    const gantt = "gantt\n  title G";

    // A mode not offered by this type (e.g. a stale 'beautiful') falls back to
    // the type default rather than being honored.
    plugin.setMode(gantt, "beautiful");
    expect(plugin.getMode(gantt)).toBe("system");

    // A valid remembered mode is honored.
    plugin.setMode(gantt, "source");
    expect(plugin.getMode(gantt)).toBe("source");
  });

  it("getMode returns the type default when nothing is remembered", () => {
    const plugin = makePlugin();
    expect(plugin.getMode("flowchart TD\n A-->B")).toBe("beautiful");
    expect(plugin.getMode("pie\n \"A\": 1")).toBe("system");
  });
});

// --- beautiful-mermaid render path ---------------------------------------------

describe("beautiful-mermaid render path", () => {
  it("renders the SVG into an .abm-beautiful container on success", async () => {
    const svg = "<svg id=\"beautiful-output\">content</svg>";
    renderBeautiful.mockResolvedValue(svg);
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "flowchart TD\n  A --> B", el);

    const container = el.querySelector(".abm-beautiful");
    expect(container).not.toBeNull();
    expect((container as HTMLElement).innerHTML).toContain("beautiful-output");
    expect(el.querySelector(".abm-error")).toBeNull();
  });

  it("renders an .abm-error box with engine, message and source on failure", async () => {
    renderBeautiful.mockRejectedValue(new Error("beautiful boom"));
    const plugin = makePlugin();
    const el = document.createElement("div");
    const source = "flowchart TD\n  A --> B";

    await route(plugin, source, el);

    const errorBox = el.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    const text = (errorBox as HTMLElement).textContent ?? "";
    expect(text).toContain("beautiful-mermaid");
    expect(text).toContain("beautiful boom");

    const code = el.querySelector(".abm-error pre code");
    expect(code).not.toBeNull();
    expect((code as HTMLElement).textContent).toBe(source);

    expect(el.querySelector(".abm-beautiful")).toBeNull();
  });
});

// --- renderError ---------------------------------------------------------------

describe("renderError", () => {
  it("stringifies non-Error values into the message", () => {
    const el = document.createElement("div");
    renderError(el, "beautiful-mermaid", "plain string failure", "graph TD");

    const message = el.querySelector(".abm-error-message");
    expect((message as HTMLElement).textContent).toBe("plain string failure");
  });
});

// --- appendSvg -----------------------------------------------------------------

describe("appendSvg", () => {
  it("parses and appends a valid <svg> as a real DOM node", () => {
    const host = document.createElement("div");
    appendSvg(host, '<svg id="parsed-output"><g>content</g></svg>');

    const svg = host.querySelector("svg");
    expect(svg).not.toBeNull();
    expect((svg as Element).getAttribute("id")).toBe("parsed-output");
    expect(host.childNodes.length).toBe(1);
  });

  it("binds the appended node to the host's owner document", () => {
    const host = document.createElement("div");
    appendSvg(host, "<svg>content</svg>");

    expect((host.firstChild as Element).ownerDocument).toBe(host.ownerDocument);
  });

  it("throws when the parsed root is not an <svg> element", () => {
    const host = document.createElement("div");
    expect(() => appendSvg(host, "this is not svg")).toThrow(/invalid SVG/i);
  });
});

// --- findMermaidFences ---------------------------------------------------------

describe("findMermaidFences", () => {
  it("locates a single mermaid fence and extracts its inner source", () => {
    const doc = "intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\noutro";
    const fences = findMermaidFences(doc);

    expect(fences).toHaveLength(1);
    expect(fences[0].source).toBe("flowchart TD\n  A --> B");
    expect(doc.slice(fences[0].from, fences[0].from + 3)).toBe("```");
  });

  it("locates multiple fences in document order", () => {
    const doc = "```mermaid\ngraph TD\n```\ntext\n```mermaid\npie\n```";
    const fences = findMermaidFences(doc);

    expect(fences.map((f) => f.source)).toEqual(["graph TD", "pie"]);
  });

  it("ignores fences for other languages", () => {
    const doc = "```js\nconst a = 1;\n```\n\n```python\nx = 2\n```";
    expect(findMermaidFences(doc)).toHaveLength(0);
  });

  it("supports tilde fences and matching closing markers", () => {
    const doc = "~~~mermaid\nsequenceDiagram\n  A->>B: hi\n~~~";
    const fences = findMermaidFences(doc);

    expect(fences).toHaveLength(1);
    expect(fences[0].source).toBe("sequenceDiagram\n  A->>B: hi");
  });

  it("returns no fences for an unterminated block", () => {
    const doc = "```mermaid\nflowchart TD\n  A --> B";
    expect(findMermaidFences(doc)).toHaveLength(0);
  });
});

// --- Live Preview widget rendering (renderWidget) ------------------------------

describe("renderWidget", () => {
  it("mounts a toggleable container with a synchronous Beautiful render", () => {
    renderBeautifulSync.mockReturnValue('<svg id="lp-beautiful">x</svg>');
    const plugin = makePlugin();

    const { host } = plugin.renderWidget("flowchart TD\n  A --> B");

    expect(renderBeautifulSync).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".abm-block")).not.toBeNull();
    const container = host.querySelector(".abm-beautiful");
    expect(container).not.toBeNull();
    expect((container as HTMLElement).querySelector("svg")).not.toBeNull();
    expect(host.querySelector(".abm-error")).toBeNull();
  });

  it("shows an error box when the synchronous beautiful render throws", () => {
    renderBeautifulSync.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const plugin = makePlugin();

    const { host } = plugin.renderWidget("flowchart TD\n  A --> B");

    const errorBox = host.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("beautiful-mermaid");
    expect((errorBox as HTMLElement).textContent).toContain("sync boom");
  });

  it("returns a loaded render child whose containerEl is the host (System lifecycle)", () => {
    renderBeautifulSync.mockReturnValue("<svg>x</svg>");
    const plugin = makePlugin();

    const { host, child } = plugin.renderWidget("flowchart TD\n  A --> B");

    expect(child).toBeInstanceOf(MarkdownRenderChild);
    expect(child.containerEl).toBe(host);
    expect((child as unknown as { loaded: boolean }).loaded).toBe(true);
  });

  it("renders the System view under the widget's child component, not the plugin", async () => {
    renderBeautifulSync.mockReturnValue("<svg>x</svg>");
    const plugin = makePlugin();

    const { host, child } = plugin.renderWidget("flowchart TD\n  A --> B");
    (host.querySelector('button[data-mode="system"]') as HTMLElement).click();
    await Promise.resolve();

    expect(markdownRender).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("flowchart TD\n  A --> B"),
      expect.any(HTMLElement),
      "",
      child,
    );
  });
});
