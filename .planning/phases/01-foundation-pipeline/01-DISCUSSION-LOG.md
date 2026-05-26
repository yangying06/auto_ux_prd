# Phase 1: Foundation & Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 01-foundation-pipeline
**Areas discussed:** 路由方案选择, 上传与拆解UX流程, 树节点数据模型, 拆解进度反馈机制

---

## 路由方案选择

| Option | Description | Selected |
|--------|-------------|----------|
| wouter (hash mode) | 1.3kB，支持hash路由，Tauri友好。API简单：useRoute/useLocation。但生态较小。 | ✓ |
| react-router-dom v7 | 50kB，功能完整（loader/action/outlet）。需用MemoryRouter以兼容Tauri。社区大、文档多。 | |
| 状态驱动视图切换 | 不用路由库，用Zustand state控制当前视图（{view: 'map'|'forge', nodeId}）。最简单，但没有URL历史。 | |

**User's choice:** wouter (hash mode)
**Notes:** 用户倾向轻量方案，app只有2个视图不需要复杂路由

---

## 上传与拆解UX流程

| Option | Description | Selected |
|--------|-------------|----------|
| 落地页 → 进度 → 导图 | 打开app时就是上传界面（居中卡片+拖拽区），上传后原地变为拆解进度，完成后自动跳到导图 | ✓ |
| 导图页顶栏上传按钮 | 导图页就是主页，上传按钮在顶栏（如设计稿），空状态显示提示 | |
| 模态弹窗上传 | 点击上传按钮后弹出全屏覆盖层，拖拽或选择文件，处理完关闭覆盖层 | |

**User's choice:** 落地页 → 进度 → 导图
**Notes:** None

### 落地页视觉风格

| Option | Description | Selected |
|--------|-------------|----------|
| 最简卡片式 | 居中卡片：应用名 + 简介 + 拖拽区域，简洁高级感 | |
| 保持设计稿风格 | 设计稿风格：带Blueprint网格背景 + 中间卡片 + 顶栏 | |
| Claude决定 | 让Claude决定，只要符合Forge Blueprint设计系统 | ✓ |

**User's choice:** Claude决定
**Notes:** 用户将落地页视觉设计交给Claude自由发挥，约束是必须符合Forge Blueprint设计系统

---

## 树节点数据模型

| Option | Description | Selected |
|--------|-------------|----------|
| 基础模型 | id, parentId, label, summary, content(full text), type(module|feature|ui), status(pending|done), children[] | |
| 基础 + 元数据 | 基础 + level(depth), order(sort), extractedFrom(source range), techNotes | ✓ |
| 完整模型 | 基础 + 元数据 + completionRate(0-100), chatSessionId, specContent(final output) | |

**User's choice:** 基础 + 元数据
**Notes:** completionRate等字段属于Phase 3(Forge)范围，Phase 1只需要拆解所需的字段

### 节点打磨标记

| Option | Description | Selected |
|--------|-------------|----------|
| 叶子=UI节点，非叶子=分类 | 所有叶子节点都是"需要打磨"的UI节点，非叶子是分类节点（module/feature） | |
| 叶子有两种类型 | 有些叶子是纯信息节点（不需打磨），有些是UI节点（需打磨） | |
| AI标记needsPolish字段 | AI拆解时标记每个节点是否需要打磨，不严格按叶子/非叶子区分 | ✓ |

**User's choice:** AI标记needsPolish字段
**Notes:** 更灵活，让AI根据内容判断哪些节点描述了UI交互

---

## 拆解进度反馈机制

| Option | Description | Selected |
|--------|-------------|----------|
| SSE流式进度 | Server用SSE流式返回拆解进度（"正在分析第2/5个模块..."），前端实时更新 | |
| 一次性返回 + 加载动画 | 先返回"开始拆解"，完成后一次性返回全部结果。显示旋转动画+预估时间。 | |
| 分步拆解 + 逐步渲染 | Server分步调用Claude（先拆第一层，再逐个展开），每步返回部分结果，前端逐步渲染 | ✓ |

**User's choice:** 分步拆解 + 逐步渲染
**Notes:** 用户希望看到树"逐渐生长"的效果，而不是等待后一次性显示

---

## Claude's Discretion

- 落地页视觉设计（符合Forge Blueprint设计系统即可）
- 具体的decomposition prompt工程策略
- 上传失败或拆解失败的错误状态设计

## Deferred Ideas

None
