import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { renderMermaidSVGAsync } from "beautiful-mermaid";
import mermaid from "mermaid";

import AutoBeautifulMermaidPlugin, { extractDiagramType, renderError } from "./main";

// --- External dependency mocks -------------------------------------------------

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVGAsync: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

const renderBeautiful = renderMermaidSVGAsync as unknown as Mock;
const mermaidInitialize = mermaid.initialize as unknown as Mock;
const mermaidRender = mermaid.render as unknown as Mock;

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
