---
name: deploy-and-verify
description: Build, test, deploy to vault, and verify the plugin. Use whenever a code or CSS change is ready to ship.
metadata:
  author: auto-beautiful-mermaid
  version: "1.0"
---

Build → test → structural checks → deploy to vault → remind user to reload.

---

**Trigger**: User says "部署", "deploy", "ship", "发布", or any code change is complete.

**Steps**

1. **Build and test**

   ```bash
   cd /Users/dinghongyubj/Documents/GitHub/auto-beautiful-mermaid
   npm run build
   npx vitest run
   ```

   Both must pass. Current test baseline: **64 tests**. If tests fail, fix before proceeding.

2. **Structural checks**

   ```bash
   # No runtime language-mermaid class assignment in bundle
   grep -c 'className.*language-mermaid\|language-mermaid"' main.js
   # Expected: 0

   # No leftover diagnostic logs
   grep -c 'ABM-DIAG' main.js
   # Expected: 0
   ```

   If either returns > 0, fix before deploying.

3. **Deploy to vault**

   ```bash
   VAULT=~/Documents/obsidian-notes/.obsidian/plugins/auto-beautiful-mermaid
   cp main.js styles.css "$VAULT/"
   shasum main.js "$VAULT/main.js"
   ```

   Both `shasum` lines must show the same hash.

4. **Remind user to reload**

   `obsidian reload` does NOT reload plugin JS. The user must:

   > Settings → Community Plugins → Auto Beautiful Mermaid → **Disable → Enable**

5. **Commit**

   ```bash
   git add src/ main.js styles.css
   git commit -m "<type>: <what and why>"
   ```

   Commit checklist:
   - Implementation + openspec archive in the **same commit** — never split
   - No `console.log` or `ABM-DIAG` in `src/main.ts`
   - `main.js` and `styles.css` both included (they are the installed artifacts)

**Output**

Report: tests passed, hash match confirmed, user reminded to toggle the plugin.
