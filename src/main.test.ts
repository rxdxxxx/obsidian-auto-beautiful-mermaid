import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import * as obsidian from "obsidian";

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

// Test-only controls on the obsidian mock (not in the real obsidian types).
const { __setMermaidRender, __failNextLoad, __loadMermaidCalls, __resetMermaid } =
  obsidian as unknown as {
    __setMermaidRender: (
      fn: (id: string, source: string) => Promise<{ svg?: string } | string>,
    ) => void;
    __failNextLoad: (times?: number) => void;
    __loadMermaidCalls: () => number;
    __resetMermaid: () => void;
  };

// --- External dependency mocks -------------------------------------------------

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: vi.fn(),
  renderMermaidSVGAsync: vi.fn(),
}));

const renderBeautiful = renderMermaidSVGAsync as unknown as Mock;
const renderBeautifulSync = renderMermaidSVG as unknown as Mock;

/** Build a fresh plugin instance for a render call. */
function makePlugin(): AutoBeautifulMermaidPlugin {
  // The mocked Plugin base class takes (app, manifest) and ignores them.
  return new AutoBeautifulMermaidPlugin({} as never, {} as never);
}

/** Reach the plugin's private members at runtime for white-box assertions. */
function internals(plugin: AutoBeautifulMermaidPlugin): {
  handleMermaid: (s: string, e: HTMLElement, c: unknown) => Promise<void>;
  renderSystemInto: (slot: HTMLElement, source: string) => Promise<void>;
} {
  return plugin as unknown as never;
}

/** Settle the lazily-fired async System render after a mount/click. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
  __resetMermaid();
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
    // System is lazy: not loaded until the reader switches to it.
    expect(__loadMermaidCalls()).toBe(0);
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
    await flush();

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
    // System default → native render via loadMermaid, SVG injected into the slot,
    // and crucially NO code.language-mermaid anywhere.
    expect(__loadMermaidCalls()).toBe(1);
    expect((el.querySelector(".abm-view-system") as HTMLElement).querySelector("svg")).not.toBeNull();
    expect(el.querySelectorAll("code.language-mermaid").length).toBe(0);
  });

  it("owns a block with no extractable type (default System)", async () => {
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "\n%% only a comment\n   \n", el);
    await flush();

    expect((el.querySelector(".abm-block") as HTMLElement).dataset.mode).toBe("system");
    expect(renderBeautiful).not.toHaveBeenCalled();
    expect(__loadMermaidCalls()).toBe(1);
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

  it("System output is confined to the System slot and emits no code.language-mermaid", async () => {
    renderBeautiful.mockResolvedValue("<svg>ok</svg>");
    __setMermaidRender(async () => ({ svg: '<svg id="sys">x</svg>' }));
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, SUPPORTED, el);
    (el.querySelector('button[data-mode="system"]') as HTMLElement).click();
    await flush();

    const systemSlot = el.querySelector(".abm-view-system") as HTMLElement;
    expect(systemSlot.querySelector("svg#sys")).not.toBeNull();
    // The injected SVG is the ONLY system render, and there is no native-scannable
    // node anywhere in the block.
    expect(nativeScanCount(el)).toBe(0);
  });
});

// --- System render via loadMermaid ---------------------------------------------

describe("renderSystemInto (loadMermaid)", () => {
  it("loads mermaid, renders, and injects the SVG into the slot", async () => {
    __setMermaidRender(async (id) => ({ svg: `<svg id="${id}">x</svg>` }));
    const plugin = makePlugin();
    const slot = document.createElement("div");

    await internals(plugin).renderSystemInto(slot, "timeline\n title T");

    expect(__loadMermaidCalls()).toBe(1);
    expect(slot.querySelector("svg")).not.toBeNull();
    expect(slot.querySelector("code.language-mermaid")).toBeNull();
  });

  it("loads mermaid at most once across multiple System renders (cached)", async () => {
    const plugin = makePlugin();
    await internals(plugin).renderSystemInto(document.createElement("div"), "timeline\n a");
    await internals(plugin).renderSystemInto(document.createElement("div"), "gantt\n b");

    expect(__loadMermaidCalls()).toBe(1);
  });

  it("accepts a bare-string render result", async () => {
    __setMermaidRender(async () => "<svg id=\"bare\">x</svg>");
    const plugin = makePlugin();
    const slot = document.createElement("div");

    await internals(plugin).renderSystemInto(slot, "pie\n title P");

    expect(slot.querySelector("svg#bare")).not.toBeNull();
  });

  it("shows an error box in the slot when mermaid.render rejects", async () => {
    __setMermaidRender(async () => {
      throw new Error("mermaid boom");
    });
    const plugin = makePlugin();
    const slot = document.createElement("div");

    await internals(plugin).renderSystemInto(slot, "pie\n bad");

    const errorBox = slot.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("mermaid boom");
  });

  it("does not poison the cache when the first load fails — a later render retries", async () => {
    __failNextLoad(1); // first loadMermaid() rejects
    const plugin = makePlugin();

    const slot1 = document.createElement("div");
    await internals(plugin).renderSystemInto(slot1, "timeline\n a");
    expect(slot1.querySelector(".abm-error")).not.toBeNull(); // first attempt errored

    const slot2 = document.createElement("div");
    await internals(plugin).renderSystemInto(slot2, "timeline\n a");
    expect(slot2.querySelector("svg")).not.toBeNull(); // retried and succeeded
    expect(__loadMermaidCalls()).toBe(2); // not stuck on a cached rejection
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

    const host = plugin.renderWidget("flowchart TD\n  A --> B");

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

    const host = plugin.renderWidget("flowchart TD\n  A --> B");

    const errorBox = host.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("beautiful-mermaid");
    expect((errorBox as HTMLElement).textContent).toContain("sync boom");
  });

  it("renders the System view via loadMermaid (unsupported type in Live Preview)", async () => {
    __setMermaidRender(async () => ({ svg: '<svg id="lp-sys">x</svg>' }));
    const plugin = makePlugin();

    const host = plugin.renderWidget("timeline\n  title T");
    await flush();

    // Unsupported → default System → loaded once, SVG injected, no native node.
    expect(__loadMermaidCalls()).toBe(1);
    expect((host.querySelector(".abm-view-system") as HTMLElement).querySelector("svg#lp-sys")).not.toBeNull();
    expect(host.querySelector("code.language-mermaid")).toBeNull();
  });
});
