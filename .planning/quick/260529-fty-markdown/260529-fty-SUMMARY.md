# Quick Task 260529-fty Summary

## Completed

- 将 PRD 导入后的等待弹窗改为全屏动态解析视图：左侧展示解析步骤和进度，右侧在首批节点返回前展示解析动画，节点返回后直接展示实时导图。
- 导图连线改为按布局坐标生成的 SVG 曲线，并加入绘制动画；解析占位画布也使用同一套连线动效。
- 优化节点卡片尺寸和排版，根节点、分组节点、文档包节点分别使用固定版式，避免内容把卡片撑乱。
- 新增轻量 Markdown 渲染预览，用于节点卡片和文档详情，支持标题、引用、无序/有序列表、表格和行内代码。
- 移除生成完成后的“查看导图”中间页，完成后直接切换到导图画布。

## Verification

- `npm run typecheck`
- `npm run build`
- Browser opened `http://127.0.0.1:5173/` and verified the upload entry renders.
- Local dev server ran with `MOCK_DECOMPOSE=true`; `/api/decompose/start` plus polling returned progressive node counts and final `done` status.
- `node .planning/quick/260529-fty-markdown/e2e-verify.mjs`
  - Upload flow: 8 node cards, 5 connector lines, no “查看导图” screen, export button visible, connector animation uses `draw-line`.
  - Markdown preview: headings, list content, inline code, preview label, and connector animation all verified.

## Notes

- 本次没有提交 commit；工作区在任务开始前已有大量未提交改动，按现状保留。
- E2E screenshots and result JSON are stored in this quick task directory for review.
