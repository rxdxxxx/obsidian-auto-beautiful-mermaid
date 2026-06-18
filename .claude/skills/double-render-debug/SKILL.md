---
name: double-render-debug
description: Diagnose and fix duplicate mermaid diagrams in this plugin. Use when the user reports seeing two diagrams where one is expected.
metadata:
  author: auto-beautiful-mermaid
  version: "1.0"
---

Locate and fix the double-render source. Do NOT change code before seeing DOM evidence.

---

**Trigger**: User reports seeing two mermaid diagrams (one with toolbar, one without).

**Steps**

1. **Ask the discriminating question first**

   Ask the user: "带 toolbar 的有几个？"

   - One with toolbar + one bare → duplicate render, continue below
   - Two with toolbars → plugin loaded twice, check `~/.obsidian/plugins/` for duplicate installs

2. **Get DOM evidence via DevTools**

   Ask the user to open Obsidian DevTools (`Cmd+Opt+I` → Console), type `allow pasting`, then run:

   ```js
   document.querySelectorAll('.abm-block, .mermaid, .cm-preview-code-block').forEach((el, i) => {
     const r = el.getBoundingClientRect();
     console.log(i, el.className.slice(0, 60), 'top:', Math.round(r.top),
       'parent:', el.parentElement?.className?.slice(0, 60));
   });
   ```

   Read the output:
   - `.mermaid` visible at same `top` as `.abm-block` → **Fix A** (Live Preview)
   - `.abm-block` present but no `.mermaid` → **Fix B** (Reading View)

3. **Fix A — Live Preview: CSS suppression**

   Obsidian's built-in mermaid StateField independently renders a `div.mermaid` inside
   `cm-preview-code-block.cm-lang-mermaid`. Our `Decoration.replace` only covers fence text,
   not this widget. Fix in `styles.css`:

   ```css
   .cm-preview-code-block.cm-lang-mermaid {
     display: none !important; /* !important required — Obsidian's own styles win otherwise */
   }
   ```

   Verify CSS is active before editing:
   ```js
   getComputedStyle(document.querySelector('.cm-preview-code-block.cm-lang-mermaid')).display
   // Expected: 'none' — if 'block', the rule is missing or !important is absent
   ```

4. **Fix B — Reading View: clear `el` before mounting**

   Obsidian pre-fills `el` with `<pre><code class="language-mermaid">` before calling our handler.
   If `mountMermaidBlock` only appends `.abm-block`, that node survives and the native
   PostProcessor renders it as a second bare diagram.

   Fix at the top of `mountMermaidBlock` in `src/main.ts`:

   ```ts
   // Clear Obsidian's pre-populated <pre><code class="language-mermaid"> before mounting.
   // Do NOT use host.empty() — Obsidian API extension, throws TypeError in jsdom tests.
   while (host.firstChild) host.removeChild(host.firstChild);
   ```

5. **Build, deploy, verify**

   After any code or CSS change, run `/deploy-and-verify` to build, deploy, and confirm.

**Guardrails**

- Never touch `sortOrder` — it does not prevent the section-level PostProcessor from scanning
- Never use `MarkdownRenderer.render` + `recreateNativeFence` — creates `code.language-mermaid` which the outer PP double-consumes; this path is permanently abandoned
- Never rename/neutralize the `language-mermaid` class after-the-fact — outer PP scan timing is uncontrollable
- Always get DOM evidence before changing code
