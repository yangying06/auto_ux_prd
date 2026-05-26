# Roadmap: GameUX PromptForge — PRD文档拆解导图

## Overview

Build a desktop-web tool that takes a raw PRD Markdown file and delivers a set of interaction design spec documents — one per UI node — that are ready to hand to developers. The journey runs through four phases: establishing the data pipeline (upload → AI decomposition → store), rendering an interactive mindmap with node preview, building the per-node Deep Forge polish workflow, and completing the export delivery loop.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Pipeline** - Infrastructure, upload, and AI decomposition — the full MD-to-tree pipeline
- [ ] **Phase 2: Mindmap & Preview** - Interactive markmap rendering with node status badges and preview drawer
- [ ] **Phase 3: Deep Forge** - Per-node chat-based requirement polish with AI completion assessment
- [ ] **Phase 4: Export** - Zip export of completed spec documents, gated on full node completion

## Phase Details

### Phase 1: Foundation & Pipeline
**Goal**: Users can upload a PRD Markdown file and see the AI-generated tree structure stored in the app
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, UPLD-01, UPLD-02, UPLD-03, DCMP-01, DCMP-02, DCMP-03, DCMP-04
**Success Criteria** (what must be TRUE):
  1. User can drag-and-drop or pick a Markdown file and see a progress indicator during upload
  2. AI decomposition streams progress feedback while processing the document
  3. Decomposed tree (flat node map) is stored in Zustand store with valid structure (normalizer passes)
  4. App routes between / (map view) and /forge/:nodeId without page reload
  5. Large documents (up to ~10MB) upload without server error
**Plans**: 4 plans
**UI hint**: yes

Plans:
- [ ] 01-01-PLAN.md — Types, store migration (v3→v4), Express body limit fix
- [ ] 01-02-PLAN.md — Server decomposition endpoint with Claude tool-use pipeline
- [ ] 01-03-PLAN.md — Upload UI components (UploadCard, DecompProgress, MapPage)
- [ ] 01-04-PLAN.md — wouter routing setup, ForgePage stub, end-to-end wiring

### Phase 2: Mindmap & Preview
**Goal**: Users can visually explore the document structure as an interactive mindmap and inspect any node
**Depends on**: Phase 1
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04, MAP-05, MAP-06, PRVW-01, PRVW-02, PRVW-03, PRVW-04
**Success Criteria** (what must be TRUE):
  1. Mindmap renders the full document tree using markmap with dark Forge Blueprint theme
  2. Each node displays a status badge (unprocessed / complete)
  3. User can zoom, pan, and fit the map; zoom level is preserved when tree data updates
  4. Clicking a node opens a right-side preview drawer showing the node summary, tech notes, and ID badge
  5. Preview drawer contains an "Enter Deep Forge" button that navigates to /forge/:nodeId
**Plans**: TBD
**UI hint**: yes

### Phase 3: Deep Forge
**Goal**: Users can polish each UI node's requirements through an AI-assisted chat session and mark it complete
**Depends on**: Phase 2
**Requirements**: FORG-01, FORG-02, FORG-03, FORG-04, FORG-05, FORG-06, FORG-07
**Success Criteria** (what must be TRUE):
  1. Each node has its own independent chat history that persists within the session
  2. AI receives the node's content as context and evaluates completion, suggesting confirmation when ready
  3. User can manually confirm a node as complete; confirmed node auto-navigates back to the map
  4. Forge chat can reference other node content as additional context
  5. Server /api/node-chat endpoint injects node content into the Claude prompt
**Plans**: TBD
**UI hint**: yes

### Phase 4: Export
**Goal**: Users can download a structured zip of Markdown spec documents for all completed nodes
**Depends on**: Phase 3
**Requirements**: EXPT-01, EXPT-02, EXPT-03, EXPT-04
**Success Criteria** (what must be TRUE):
  1. Export button is disabled and visually gated until every leaf node is marked complete
  2. Each completed leaf node generates one Markdown spec document
  3. Spec documents are packed into a zip whose folder structure mirrors the tree hierarchy
  4. User can download the zip and find files named and organized by their position in the tree
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Pipeline | 0/4 | Planned | - |
| 2. Mindmap & Preview | 0/TBD | Not started | - |
| 3. Deep Forge | 0/TBD | Not started | - |
| 4. Export | 0/TBD | Not started | - |
