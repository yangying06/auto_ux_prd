# Phase 2: Mindmap & Preview - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 02-mindmap-preview
**Areas discussed:** 渲染方式, MapPage 布局切换, 节点交互模型, 预览 Drawer 状态

---

## 渲染方式

| Option | Description | Selected |
|--------|-------------|----------|
| 真 markmap SVG 渲染 | markmap-lib + markmap-view，D3 overlay 覆盖 Forge Blueprint 主题 + 状态 badge | |
| 自定义列式树（套设计稿） | 完全用 React 实现 Image 2.html 的效果，不用 markmap-view | |
| markmap 做数据解析 + 自定义 React 渲染 | 只用 markmap-lib Transformer 解析，React 自定义树组件 | ✓ |

**User's choice:** markmap 做数据解析 + 自定义 React 渲染

---

### 树布局风格

| Option | Description | Selected |
|--------|-------------|----------|
| 精对设计稿（按列排列） | 和 Image 2.html 一致，根节点列 + 模块列 + 叶子列，SVG 连线 | ✓ |
| 缩放平移自由画布 | 全屏画布，节点绝对定位，用户可拖动 | |

**User's choice:** 精对设计稿（按列排列）

---

## MapPage 布局切换

| Option | Description | Selected |
|--------|-------------|----------|
| 原地变形（居中卡淡出→全屏） | MapPage 内部用 stage==='map' 渲染导图全屏布局 | ✓ |
| 导航到新路由 | 拆解完成后 wouter 跳转到 #/map | |

**User's choice:** 原地变形（居中卡淡出→全屏）

### 过渡动画

| Option | Description | Selected |
|--------|-------------|----------|
| 居中卡淡出，全屏布局淡入 | opacity 过渡，不做尺寸动画 | ✓ |
| CSS scale + fade 过渡 | 居中卡缩小 + 淡出，导图左侧滑入 | |

**User's choice:** 居中卡淡出，全屏布局淡入

---

## 节点交互模型

| Option | Description | Selected |
|--------|-------------|----------|
| 单击 = 预览 Drawer，按钮进入 Forge | 单击打开预览；"Enter Deep Forge" 按钮导航 | |
| 单击 = 预览，双击 = 进入 Forge | 单击预览；双击直接跳 #/forge/:nodeId | |

**User's choice:** 两种方式都要支持（单击 → 预览 Drawer；双击 → 直接进入 Forge）

---

## 预览 Drawer 状态

| Option | Description | Selected |
|--------|-------------|----------|
| 默认关闭，单击节点后滑入 | 导图初始全宽，点击后面板从右侧滑入 | ✓ |
| 默认占位（显示占位文字） | 进入导图时就分 70/30 | |

**User's choice:** 默认关闭，单击节点后滑入

### 缩放平移

**User's choice:** You decide（Claude 自主选择实现方式）

---

## Claude's Discretion

- 缩放/平移实现方式（推荐 CSS transform: scale() + translate()）
- 状态 badge 具体视觉映射（pending → 橙色 "To Process"，done → 绿色 "Generated"）

## Deferred Ideas

None.
