# Quick Task 260602-nb6 Summary

## Task

优化 PRD 导图 MVC 拆分：让 Model/Ctrl/View 按证据驱动分类而不是关键词乱分；同时在左侧 AI 聊天增加上传入口，用补充文本/资源生成待确认的新节点或更新节点操作。

## Completed

- Extended PRD node types with MVC audiences (`model`, `ctrl`, `view`) plus provenance fields (`sourceKind`, `evidenceRefs`).
- Reworked server-side MVC decomposition guidance so Model/Ctrl/View are classified by evidence dimension rather than keyword matching.
- Removed branch-level keyword reclassification that could override AI output incorrectly.
- Added `/api/prd-node-suggestions` for review-only create/update node suggestions from user text or uploaded supplement files.
- Added Forge chat supplement upload/paste flow with `生成节点建议` and pending operation review cards.
- Added Zustand state/actions so suggestions only mutate `prdTree` after explicit Apply; Dismiss does not mutate the map.

## Verification

- `npm run typecheck` passed.
- `npm run build` passed.

## Commit

Not committed from this session because the working tree already contained many unrelated uncommitted changes in the same tracked files before this task. Committing specific files would risk bundling prior user work.