---
mode: quick
id: 260601-ofu
phase: quick-260601-ofu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - prd.json
  - progress.txt
  - archive/ralph/prototype-screenshot-to-code-variants/prd.json
  - archive/ralph/prototype-screenshot-to-code-variants/progress.txt
autonomous: true
requirements:
  - RALPH-PAGE-MINDMAP-PRD
must_haves:
  truths:
    - "Current Ralph prd.json/progress.txt are archived before replacing them because the existing branchName is ralph/prototype-screenshot-to-code-variants."
    - "New prd.json uses branchName ralph/page-level-mindmap-refinement and follows the existing Ralph JSON format exactly."
    - "New prd.json decomposes 页面级思维导图拆分与打磨 into one-iteration user stories covering node model extension, node operation UI, AI adjustment chat, page-level split prompt, page-level refinement flow, and page-level spec folder export."
    - "progress.txt is reset with a fresh header for the new Ralph feature."
  artifacts:
    - path: "archive/ralph/prototype-screenshot-to-code-variants/prd.json"
      provides: "Archived previous Ralph PRD JSON before branch switch"
    - path: "archive/ralph/prototype-screenshot-to-code-variants/progress.txt"
      provides: "Archived previous Ralph progress log before branch switch"
    - path: "prd.json"
      provides: "New Ralph PRD JSON for page-level mind map refinement"
      contains: "\"branchName\": \"ralph/page-level-mindmap-refinement\""
    - path: "progress.txt"
      provides: "Fresh Ralph progress log for the new feature"
      contains: "Branch: ralph/page-level-mindmap-refinement"
  key_links:
    - from: "prd.json"
      to: "progress.txt"
      via: "matching branch and feature header"
      pattern: "ralph/page-level-mindmap-refinement"
---

<objective>
Create a Ralph planning/config update for the accepted GameUX PromptForge feature “页面级思维导图拆分与打磨”.

Purpose: switch Ralph tracking from the completed prototype screenshot-to-code variants branch to the new page-level mind map refinement branch without losing the current PRD/progress artifacts.
Output: archived old `prd.json`/`progress.txt`, new Ralph-format `prd.json`, and reset `progress.txt` header.
</objective>

<execution_context>
@D:/learn/auto_ux_prd/CLAUDE.md
@D:/learn/auto_ux_prd/.planning/STATE.md
</execution_context>

<context>
@D:/learn/auto_ux_prd/prd.json
@D:/learn/auto_ux_prd/progress.txt

Known current state from mandatory read:
- Existing `prd.json` branchName is `ralph/prototype-screenshot-to-code-variants`.
- Existing `progress.txt` branch is `ralph/prototype-screenshot-to-code-variants`.
- This plan is docs/config only. Do not edit app code and do not modify `ROADMAP.md`.

New feature design to encode:
- Project: GameUX PromptForge
- Feature: 页面级思维导图拆分与打磨
- Branch name: ralph/page-level-mindmap-refinement
- Description: Add page-level mind map node management and AI-assisted restructuring/refinement so PRDs are split by screen/page, each page starts as pending refinement, can be edited as a node, opened as a generated local document, adjusted through a left-side AI chat, refined one page at a time, and exported as page-level spec files.
- Accepted design points:
  1. Mind map nodes support create, delete, edit, and opening the corresponding generated local document.
  2. Mind map left side adds an AI chat box. If split content is unreasonable, user asks AI to adjust. AI returns structured operation suggestions and user confirms before applying.
  3. AI split logic changes to page-level: 主界面/规则页/帮助页/排行榜 etc. each page is one node. Content belongs to its page node. Cross-page content is represented as references, not duplicated. All initial nodes have status “待打磨” / pending_refine.
  4. Page internals live in right-side details/document, not over-expanded on the mind map.
  5. Opening local docs should first use local Express proxy and must restrict paths to generated export/spec directory.
  6. Work should be split into: node model extension, node operation UI, AI adjustment chat, page-level split prompt, page-level refinement flow, page-level spec folder export.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Archive current Ralph PRD/progress artifacts</name>
  <files>archive/ralph/prototype-screenshot-to-code-variants/prd.json, archive/ralph/prototype-screenshot-to-code-variants/progress.txt</files>
  <action>
    Create `archive/ralph/prototype-screenshot-to-code-variants/` if it does not exist. Copy the current root `prd.json` and `progress.txt` into that directory before replacing either root file.

    Preserve file contents exactly. This archive is required because the current root `prd.json` and `progress.txt` belong to `ralph/prototype-screenshot-to-code-variants`, while the new Ralph feature uses `ralph/page-level-mindmap-refinement`.

    Do not delete or alter the old archive if it already exists; if files already exist, overwrite only after confirming they are for the same `ralph/prototype-screenshot-to-code-variants` branch.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); for (const f of ['archive/ralph/prototype-screenshot-to-code-variants/prd.json','archive/ralph/prototype-screenshot-to-code-variants/progress.txt']) { if (!fs.existsSync(f)) throw new Error('missing '+f); } const archived=JSON.parse(fs.readFileSync('archive/ralph/prototype-screenshot-to-code-variants/prd.json','utf8')); if (archived.branchName !== 'ralph/prototype-screenshot-to-code-variants') throw new Error('archived branch mismatch: '+archived.branchName); console.log('archive ok');"</automated>
  </verify>
  <done>Previous Ralph `prd.json` and `progress.txt` exist under `archive/ralph/prototype-screenshot-to-code-variants/`, and archived `prd.json.branchName` remains `ralph/prototype-screenshot-to-code-variants`.</done>
</task>

<task type="auto">
  <name>Task 2: Replace root prd.json and reset progress.txt for new Ralph feature</name>
  <files>prd.json, progress.txt</files>
  <action>
    Replace root `prd.json` with the exact Ralph-format JSON below. Keep the same top-level shape as the existing Ralph file: `project`, `branchName`, `description`, and `userStories`. Each user story must include `id`, `title`, `description`, `acceptanceCriteria`, `priority`, `passes`, and `notes`. Set every `passes` value to `false` and every `notes` value to an empty string.

    New `prd.json` content:

    ```json
    {
      "project": "GameUX PromptForge",
      "branchName": "ralph/page-level-mindmap-refinement",
      "description": "Add page-level mind map node management and AI-assisted restructuring/refinement so PRDs are split by screen/page, each page starts as pending refinement, can be edited as a node, opened as a generated local document, adjusted through a left-side AI chat, refined one page at a time, and exported as page-level spec files.",
      "userStories": [
        {
          "id": "US-001",
          "title": "Extend mind map nodes for page-level documents and refinement status",
          "description": "As a developer, I need the PRD node model to represent page/screen nodes, pending refinement status, document paths, and cross-page references so that the map can manage page-level specs without duplicating content.",
          "acceptanceCriteria": [
            "The node data model supports page-level nodes for screens such as 主界面, 规则页, 帮助页, and 排行榜",
            "Each initial page node can store status pending_refine with display text 待打磨",
            "Each page node can store a generated local document path or identifier for opening its corresponding spec document",
            "Cross-page content is represented as references between page nodes instead of duplicated content",
            "Page internals are stored for the right-side detail/document view and are not expanded as excessive child nodes on the mind map",
            "Existing mind map data can still load without crashing after the model extension",
            "Typecheck passes"
          ],
          "priority": 1,
          "passes": false,
          "notes": ""
        },
        {
          "id": "US-002",
          "title": "Add node create/delete/edit/open operations in the mind map UI",
          "description": "As a user, I want to create, delete, edit, and open page nodes from the mind map so that I can correct the page structure and jump to the generated local document for each page.",
          "acceptanceCriteria": [
            "The mind map UI provides affordances to create a new page node with a title and pending_refine status",
            "The mind map UI allows deleting a page node with an explicit confirmation or safe guard against accidental removal",
            "The mind map UI allows editing a page node title and core metadata without leaving the map context",
            "The mind map UI allows opening the corresponding generated local document for a page node",
            "Open-document behavior first routes through the local Express proxy rather than direct unrestricted filesystem access",
            "Document open paths are restricted to the generated export/spec directory and reject traversal or arbitrary local paths",
            "Typecheck passes",
            "Verify create, edit, delete, and open-document flows in the browser"
          ],
          "priority": 2,
          "passes": false,
          "notes": ""
        },
        {
          "id": "US-003",
          "title": "Add left-side AI adjustment chat with confirm-before-apply operations",
          "description": "As a user, I want a left-side AI chat on the mind map so that I can ask AI to fix unreasonable splits and review structured operation suggestions before they change the map.",
          "acceptanceCriteria": [
            "The mind map screen includes a left-side AI chat box for page split adjustment requests",
            "User messages can describe why the current page split is unreasonable and what should change",
            "The AI response returns structured operation suggestions such as create_node, delete_node, update_node, move_content, and add_reference",
            "Suggested operations are shown to the user for review before they are applied",
            "No AI-suggested operation mutates the mind map until the user explicitly confirms",
            "Confirmed operations update the page-level node data and preserve pending_refine status where appropriate",
            "Rejected or cancelled suggestions leave the existing map unchanged",
            "Typecheck passes",
            "Verify the suggestion review and confirm/cancel behavior in the browser"
          ],
          "priority": 3,
          "passes": false,
          "notes": ""
        },
        {
          "id": "US-004",
          "title": "Change PRD split prompt to produce page-level mind map nodes",
          "description": "As a user, I want imported PRDs to be split by screen/page rather than over-expanded internal details so that the mind map reflects navigable product pages.",
          "acceptanceCriteria": [
            "The AI split prompt instructs the model to identify page/screen nodes such as 主界面, 规则页, 帮助页, and 排行榜",
            "Content belonging to a page is attached to that page node instead of duplicated under multiple nodes",
            "Cross-page content is emitted as references between page nodes rather than copied into each node",
            "Every initial page node returned by AI has status pending_refine and display text 待打磨",
            "The prompt explicitly says page internals belong in the right-side details/document content, not as over-expanded mind map children",
            "The split parser validates the page-level structure and rejects malformed operation/content shapes with a clear error",
            "Typecheck passes",
            "Existing decomposition flow still reaches the map view with page-level nodes"
          ],
          "priority": 4,
          "passes": false,
          "notes": ""
        },
        {
          "id": "US-005",
          "title": "Refine one page at a time from pending to completed spec",
          "description": "As a user, I want to open a page node and refine that page through the detail/chat workflow so that each page becomes a confirmed interaction spec independently.",
          "acceptanceCriteria": [
            "Selecting a page node opens its right-side detail/document content for that page",
            "The page refinement flow works one page at a time and does not require refining every page in a single AI call",
            "A pending_refine page can be refined through AI-assisted questions or edits into a completed/confirmed spec state",
            "The UI clearly distinguishes 待打磨 pages from refined/completed pages",
            "Refining one page updates only that page's document/details and necessary references, not unrelated page specs",
            "The page detail/document remains the source of internal page requirements while the mind map stays page-level",
            "Typecheck passes",
            "Verify in the browser that one page can be refined while other pages remain 待打磨"
          ],
          "priority": 5,
          "passes": false,
          "notes": ""
        },
        {
          "id": "US-006",
          "title": "Export page-level spec folder with safe local document access",
          "description": "As a user, I want to export the refined page documents as a page-level spec folder so that each screen/page has its own deliverable spec file.",
          "acceptanceCriteria": [
            "Export creates a generated spec/export directory containing one spec document per page node",
            "Exported filenames or paths are derived safely from page node titles and avoid path traversal or invalid filesystem characters",
            "Each exported page spec includes the page's refined detail/document content and cross-page references",
            "The export output preserves page-level separation rather than combining all pages into one monolithic file",
            "Mind map open-document actions can open these generated page spec files through the local Express proxy",
            "The local Express proxy restricts open/read access to the generated export/spec directory only",
            "Typecheck passes",
            "Verify exported files exist and can be opened from their corresponding page nodes"
          ],
          "priority": 6,
          "passes": false,
          "notes": ""
        }
      ]
    }
    ```

    Replace root `progress.txt` with this fresh header and no completed story entries:

    ```text
    # Ralph Progress Log

    Project: GameUX PromptForge
    Branch: ralph/page-level-mindmap-refinement
    Feature: 页面级思维导图拆分与打磨
    Source PRD: prd.json
    Started: 2026-06-01

    ---

    ## Pending User Stories

    - US-001 — Extend mind map nodes for page-level documents and refinement status
    - US-002 — Add node create/delete/edit/open operations in the mind map UI
    - US-003 — Add left-side AI adjustment chat with confirm-before-apply operations
    - US-004 — Change PRD split prompt to produce page-level mind map nodes
    - US-005 — Refine one page at a time from pending to completed spec
    - US-006 — Export page-level spec folder with safe local document access
    ```

    Do not modify `ROADMAP.md` or any app source files.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('prd.json','utf8')); if (p.project !== 'GameUX PromptForge') throw new Error('project mismatch'); if (p.branchName !== 'ralph/page-level-mindmap-refinement') throw new Error('branch mismatch: '+p.branchName); if (!Array.isArray(p.userStories) || p.userStories.length !== 6) throw new Error('expected 6 stories'); const required=['id','title','description','acceptanceCriteria','priority','passes','notes']; p.userStories.forEach((s,i)=>{ for (const k of required) if (!(k in s)) throw new Error('story '+(i+1)+' missing '+k); if (s.id !== 'US-'+String(i+1).padStart(3,'0')) throw new Error('bad id '+s.id); if (s.passes !== false) throw new Error(s.id+' passes must be false'); if (s.notes !== '') throw new Error(s.id+' notes must be empty'); if (!Array.isArray(s.acceptanceCriteria) || s.acceptanceCriteria.length < 5) throw new Error(s.id+' needs detailed criteria'); }); const progress=fs.readFileSync('progress.txt','utf8'); for (const text of ['Branch: ralph/page-level-mindmap-refinement','Feature: 页面级思维导图拆分与打磨','US-001','US-006']) if (!progress.includes(text)) throw new Error('progress missing '+text); console.log('new prd/progress ok');"</automated>
  </verify>
  <done>Root `prd.json` is valid JSON in Ralph format for `ralph/page-level-mindmap-refinement`, and root `progress.txt` is reset to a fresh header plus pending US-001 through US-006 list.</done>
</task>

<task type="auto">
  <name>Task 3: Final validation and change-scope check</name>
  <files>prd.json, progress.txt, archive/ralph/prototype-screenshot-to-code-variants/prd.json, archive/ralph/prototype-screenshot-to-code-variants/progress.txt</files>
  <action>
    Run final validation after Tasks 1-2. Confirm:
    - Root `prd.json` parses as JSON.
    - Root `prd.json.branchName` is exactly `ralph/page-level-mindmap-refinement`.
    - Archived `archive/ralph/prototype-screenshot-to-code-variants/prd.json.branchName` is exactly `ralph/prototype-screenshot-to-code-variants`.
    - Root `progress.txt` has the new branch and feature header.
    - Archive files exist.
    - `ROADMAP.md` was not modified by this quick task.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs'); const root=JSON.parse(fs.readFileSync('prd.json','utf8')); const archived=JSON.parse(fs.readFileSync('archive/ralph/prototype-screenshot-to-code-variants/prd.json','utf8')); if (root.branchName !== 'ralph/page-level-mindmap-refinement') throw new Error('root branch mismatch'); if (archived.branchName !== 'ralph/prototype-screenshot-to-code-variants') throw new Error('archive branch mismatch'); for (const f of ['progress.txt','archive/ralph/prototype-screenshot-to-code-variants/progress.txt']) if (!fs.existsSync(f)) throw new Error('missing '+f); const progress=fs.readFileSync('progress.txt','utf8'); if (!progress.includes('Branch: ralph/page-level-mindmap-refinement')) throw new Error('new progress branch missing'); console.log('final validation ok');" && git diff --name-only -- prd.json progress.txt archive/ralph/prototype-screenshot-to-code-variants/prd.json archive/ralph/prototype-screenshot-to-code-variants/progress.txt .planning/quick/260601-ofu-ralph-prd-json-branchname-prd-json-progr/260601-ofu-PLAN.md</automated>
  </verify>
  <done>Validation passes, intended files are present/changed, and no ROADMAP update is included.</done>
</task>

</tasks>

<verification>
Required final commands for executor:

```bash
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('prd.json','utf8')); if (p.branchName !== 'ralph/page-level-mindmap-refinement') throw new Error('bad branch'); if (p.userStories.length !== 6) throw new Error('bad story count'); console.log('prd valid');"
node -e "const fs=require('fs'); for (const f of ['archive/ralph/prototype-screenshot-to-code-variants/prd.json','archive/ralph/prototype-screenshot-to-code-variants/progress.txt','progress.txt']) { if (!fs.existsSync(f)) throw new Error('missing '+f); } console.log('files exist');"
```
</verification>

<success_criteria>
- `prd.json` is replaced with the new Ralph PRD for `ralph/page-level-mindmap-refinement`.
- `prd.json.userStories` contains exactly US-001 through US-006, matching the six accepted implementation slices.
- Each user story is one-iteration sized, has detailed acceptance criteria, `passes: false`, and `notes: ""`.
- `progress.txt` is reset for the new branch/feature and contains only pending story entries.
- Previous `ralph/prototype-screenshot-to-code-variants` root PRD/progress files are archived.
- `ROADMAP.md` and app source files are untouched.
</success_criteria>

<output>
After completion, update this quick task’s execution summary in the conversation; do not create an additional markdown summary unless the GSD executor requires one.
</output>
