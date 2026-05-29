# Quick Task 260529-fty: 导图流程迭代

**Date:** 2026-05-29
**Mode:** inline quick workflow

## Goal

让 PRD 拆解到导图生成的过程更连续：上传后直接进入可视化解析画布，节点逐步出现；导图连线有绘制动画；节点卡片以内嵌 Markdown 预览表达内容结构；完成后直接显示导图，不再出现“查看导图”确认界面。

## Tasks

1. 调整导入/解析流程
   - `src/pages/MapPage.tsx`
   - `src/components/upload/DecompProgress.tsx`
   - 新增解析中的空画布/动态节点提示组件

2. 优化导图视觉表达
   - `src/components/map/TreeCanvas.tsx`
   - `src/components/map/NodeCard.tsx`
   - `src/components/map/DocumentPreview.tsx`
   - `src/index.css`

3. 验证
   - `npm run typecheck`
   - `npm run build`
