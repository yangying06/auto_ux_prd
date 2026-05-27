# Quick Task 260527-ley: 修复导图中文化、多层布局和缩放交互

**Date:** 2026-05-27
**Mode:** quick

## Goal

修复导图界面的中文化、多层级展示、滚轮缩放和缩放边界问题，并让导出内容默认使用中文字段。

## Tasks

1. **中文化导图与导出**
   - Files: `src/components/map/*.tsx`, `src/pages/MapPage.tsx`, `server/index.ts`
   - Action: 将导图页面硬编码英文文案替换为中文；拆解提示词和导出 Markdown 字段明确要求中文输出。
   - Verify: 搜索导图相关英文 UI 文案，确认无残留核心英文操作文案。

2. **修复多层树布局**
   - Files: `src/components/map/TreeCanvas.tsx`, `server/index.ts`, `src/store/appStore.ts`
   - Action: 按真实层级构建列，保持同父子节点顺序；在服务端和 store merge 时重建 `children`，避免部分树覆盖导致结构丢失。
   - Verify: 构建通过；静态检查不再把所有 `level >= 2` 节点塞进一列。

3. **修复缩放交互**
   - Files: `src/components/map/TreeCanvas.tsx`
   - Action: 增加鼠标滚轮缩放、缩放边界、按钮 disabled 状态和稳定的居中/重绘逻辑。
   - Verify: `npm run build` 通过。

