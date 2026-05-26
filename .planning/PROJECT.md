# GameUX PromptForge — PRD 文档拆解导图

## What This Is

GameUX PromptForge 是一个面向游戏策划和交互设计师的桌面工具，用于将大型PRD文档自动拆解为可交互的思维导图，并对每个UI交互节点进行AI辅助的需求打磨，最终导出一套完整的交互设计spec文档。

## Core Value

**将模糊的PRD文档转化为精确的、经过逐节点确认的交互设计规格**——用户上传一份大文档，经过结构化拆解和逐项打磨后，获得可直接交付给开发的详细spec文件夹。

## Requirements

### Validated

- ✓ AI聊天对话界面（Deep Forge）— existing
- ✓ Cocos RAG知识库集成 — existing
- ✓ 状态卡片展示需求填充进度 — existing
- ✓ 原型预览生成（iframe sandbox）— existing
- ✓ Markdown文档导出 — existing

### Active

- [ ] 上传MD文档并触发AI自动拆解
- [ ] AI按职能/模块层级生成树状结构
- [ ] markmap渲染可交互思维导图
- [ ] 自定义节点样式（状态标记：未处理/已完成）
- [ ] 双击叶子节点打开交互需求打磨界面
- [ ] 每个节点独立的聊天历史记录
- [ ] AI建议完成 + 用户确认的节点完成流程
- [ ] 节点内容简略预览（hover或单击）
- [ ] 右侧面板预览节点详细内容
- [ ] 全部节点完成后导出spec文档压缩包
- [ ] Map界面与Forge界面之间的路由切换
- [ ] 节点状态持久化（先localStorage，后迁移Tauri FS）

### Out of Scope

- marker（PDF→MD）集成 — 暂不内置，用户手动上传MD
- 多文档同时管理 — 单文档模式足够
- 实时协作/多人编辑 — 单人工具
- 非UI节点的打磨流程 — 只处理UI交互节点
- 移动端适配 — 桌面优先

## Context

**现有代码基础：**
- React + Vite + Tailwind + Zustand 前端，Express + Anthropic SDK 后端代理
- 已实现 Deep Forge 聊天界面（左侧对话 + 右侧状态画布 + 原型预览）
- Tauri 桌面壳已配置但非必须（先Web开发）
- 设计稿已完成：`stitch/main/`（导图界面）、`stitch/xiangqing/`（打磨界面）
- 设计系统：暗色主题 "Forge Blueprint"，使用 Inter + JetBrains Mono 字体

**技术环境：**
- markmap 库用于基础导图渲染，外层覆盖自定义交互（双击、状态badge）
- 飞书CLI结构作为拆解参考（按职能/模块分层）
- 先Web模式开发调试，后续包装Tauri交付

**已知问题（从codebase mapping发现）：**
- Express body size limit 1MB 限制大文档上传
- 无路由系统，需新增
- 无session管理，每个节点需独立历史
- 无测试覆盖

## Constraints

- **交付形式**: 先Web版开发验证，后续包装Tauri桌面应用
- **技术栈**: 保持现有 React + Vite + Tailwind + Zustand + Express 栈
- **AI后端**: 继续使用Anthropic Claude API（通过本地Express代理）
- **设计规范**: 严格遵循 stitch/ 目录中的设计稿和 "Forge Blueprint" 设计系统
- **单文档**: 一次只处理一份PRD，不做并行管理

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 暂不集成marker | 减少复杂度，用户可手动预处理 | — Pending |
| markmap + 自定义覆盖 | markmap做基础渲染，外加自定义节点样式和交互 | — Pending |
| 先Web后Tauri | 加快开发验证循环，Tauri FS后续迁移 | — Pending |
| 单文档模式 | 简化状态管理，MVP够用 | — Pending |
| 每节点独立聊天历史 | 避免上下文污染，支持独立打磨 | — Pending |
| AI建议+用户确认完成 | 防止AI误判，给用户最终控制权 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-26 after initialization*
