import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { renderMermaidSVG, renderMermaidSVGAsync } from "beautiful-mermaid";
import mermaid from "mermaid";

import AutoBeautifulMermaidPlugin, {
  appendSvg,
  extractDiagramType,
  findMermaidFences,
  renderError,
} from "./main";

// --- External dependency mocks -------------------------------------------------

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVG: vi.fn(),
  renderMermaidSVGAsync: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

const renderBeautiful = renderMermaidSVGAsync as unknown as Mock;
const renderBeautifulSync = renderMermaidSVG as unknown as Mock;
const mermaidInitialize = mermaid.initialize as unknown as Mock;
const mermaidRender = mermaid.render as unknown as Mock;

/** Resolve pending microtasks so floating async work (widget fill) settles. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Build a fresh plugin instance and a detached host element for a render call. */
function makePlugin(): AutoBeautifulMermaidPlugin {
  // The mocked Plugin base class takes (app, manifest) and ignores them.
  return new AutoBeautifulMermaidPlugin({} as never, {} as never);
}

/** Drive a single mermaid code block through the plugin's router. */
async function route(
  plugin: AutoBeautifulMermaidPlugin,
  source: string,
  el: HTMLElement,
): Promise<void> {
  // handleMermaid is private at the type level only; reachable at runtime.
  await (plugin as unknown as {
    handleMermaid: (s: string, e: HTMLElement, c: unknown) => Promise<void>;
  }).handleMermaid(source, el, {});
}

beforeEach(() => {
  renderBeautiful.mockReset();
  renderBeautifulSync.mockReset();
  mermaidInitialize.mockReset();
  mermaidRender.mockReset();
  document.body.className = "";
});

afterEach(() => {
  document.body.className = "";
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

// --- Routing decision (handleMermaid) ------------------------------------------

describe("routing decision", () => {
  const BEAUTIFUL_CASES: Array<[string, string]> = [
    ["graph", "graph TD\n  A --> B"],
    ["flowchart", "flowchart LR\n  A --> B"],
    ["stateDiagram", "stateDiagram\n  [*] --> S1"],
    ["stateDiagram-v2", "stateDiagram-v2\n  [*] --> S1"],
    ["sequenceDiagram", "sequenceDiagram\n  A->>B: hi"],
    ["classDiagram", "classDiagram\n  class A"],
    ["erDiagram", "erDiagram\n  A ||--o{ B : has"],
    ["xychart", "xychart\n  title T"],
    ["xychart-beta", "xychart-beta\n  title T"],
  ];

  it.each(BEAUTIFUL_CASES)(
    "routes %s to beautiful-mermaid",
    async (_label, source) => {
      renderBeautiful.mockResolvedValue("<svg>ok</svg>");
      const plugin = makePlugin();
      const el = document.createElement("div");

      await route(plugin, source, el);

      expect(renderBeautiful).toHaveBeenCalledTimes(1);
      expect(renderBeautiful).toHaveBeenCalledWith(source, expect.any(Object));
      expect(mermaidRender).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["gantt", "gantt\n  title A Gantt"],
    ["pie", "pie\n  title Pie\n  \"A\" : 10"],
    ["timeline", "timeline\n  title History"],
    ["mindmap", "mindmap\n  root((center))"],
  ])("routes unsupported type %s to official mermaid.js", async (_label, source) => {
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, source, el);

    expect(mermaidRender).toHaveBeenCalledTimes(1);
    expect(renderBeautiful).not.toHaveBeenCalled();
  });

  it("falls back to official mermaid.js when no type can be extracted", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();
    const el = document.createElement("div");

    // Only comments/blank lines -> extractDiagramType returns null.
    await route(plugin, "\n%% only a comment\n   \n", el);

    expect(extractDiagramType("\n%% only a comment\n   \n")).toBeNull();
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    expect(renderBeautiful).not.toHaveBeenCalled();
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

    // Original source is preserved in a <pre><code> block.
    const code = el.querySelector(".abm-error pre code");
    expect(code).not.toBeNull();
    expect((code as HTMLElement).textContent).toBe(source);

    expect(el.querySelector(".abm-beautiful")).toBeNull();
  });
});

// --- official mermaid.js render path -------------------------------------------

describe("official mermaid.js render path", () => {
  it("renders into an .abm-official container on success", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "pie\n  title Pie", el);

    const container = el.querySelector(".abm-official");
    expect(container).not.toBeNull();
    expect((container as HTMLElement).innerHTML).toContain("official");
    expect(el.querySelector(".abm-error")).toBeNull();
  });

  it("initializes mermaid with theme 'dark' in dark mode", async () => {
    document.body.classList.add("theme-dark");
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "pie\n  title Pie", el);

    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });

  it("initializes mermaid with theme 'default' in light mode", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "pie\n  title Pie", el);

    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });

  it("calls bindFunctions with the container when provided", async () => {
    const bindFunctions = vi.fn();
    mermaidRender.mockResolvedValue({ svg: "<svg>official</svg>", bindFunctions });
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "pie\n  title Pie", el);

    const container = el.querySelector(".abm-official");
    expect(bindFunctions).toHaveBeenCalledWith(container);
  });

  it("renders an .abm-error box mentioning mermaid.js on failure", async () => {
    mermaidRender.mockRejectedValue(new Error("official boom"));
    const plugin = makePlugin();
    const el = document.createElement("div");

    await route(plugin, "pie\n  title Pie", el);

    const errorBox = el.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    const text = (errorBox as HTMLElement).textContent ?? "";
    expect(text).toContain("mermaid.js");
    expect(text).toContain("official boom");
    expect(el.querySelector(".abm-official")).toBeNull();
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
    // The node is appended, not assigned via innerHTML string.
    expect(host.childNodes.length).toBe(1);
  });

  it("binds the appended node to the host's owner document", () => {
    const host = document.createElement("div");
    appendSvg(host, "<svg>official</svg>");

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
    // The range starts at the opening fence, not the preceding blank line.
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
  it("renders a beautiful-mermaid type synchronously into .abm-beautiful", () => {
    renderBeautifulSync.mockReturnValue('<svg id="lp-beautiful">x</svg>');
    const plugin = makePlugin();

    const host = plugin.renderWidget("flowchart TD\n  A --> B");

    expect(renderBeautifulSync).toHaveBeenCalledTimes(1);
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

  it("paints a placeholder for official types, then fills the SVG asynchronously", async () => {
    mermaidRender.mockResolvedValue({ svg: "<svg>lp-official</svg>", bindFunctions: undefined });
    const plugin = makePlugin();

    const host = plugin.renderWidget("pie\n  title Pie");

    // Synchronous return: official container with a loading placeholder.
    const container = host.querySelector(".abm-official");
    expect(container).not.toBeNull();
    expect(host.querySelector(".abm-loading")).not.toBeNull();
    expect(renderBeautifulSync).not.toHaveBeenCalled();

    await flushPromises();

    // Placeholder replaced by the rendered SVG.
    expect(host.querySelector(".abm-loading")).toBeNull();
    expect((container as HTMLElement).querySelector("svg")).not.toBeNull();
    expect(mermaidRender).toHaveBeenCalledTimes(1);
  });

  it("replaces the placeholder with an error box when the official render rejects", async () => {
    mermaidRender.mockRejectedValue(new Error("lp official boom"));
    const plugin = makePlugin();

    const host = plugin.renderWidget("pie\n  title Pie");
    await flushPromises();

    expect(host.querySelector(".abm-loading")).toBeNull();
    const errorBox = host.querySelector(".abm-error");
    expect(errorBox).not.toBeNull();
    expect((errorBox as HTMLElement).textContent).toContain("mermaid.js");
    expect((errorBox as HTMLElement).textContent).toContain("lp official boom");
  });
});
