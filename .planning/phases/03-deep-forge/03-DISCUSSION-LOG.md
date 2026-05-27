# Phase 3: Deep Forge - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 03-deep-forge
**Mode:** Auto (user requested no interruptions — Claude selected recommended defaults)
**Areas discussed:** ForgePage布局, 聊天历史存储, AI完成信号, 确认流程, API端点设计

---

## ForgePage布局

| Option | Description | Selected |
|--------|-------------|----------|
| 全屏聊天（仅header显示节点名） | 类Phase 1 AppShell，节点信息折叠在header | |
| 双列分屏（左节点详情+右聊天） | 左~360px节点面板，右flex-1聊天区，与PreviewDrawer风格一致 | ✓ |
| 三栏（左导航树+中节点+右聊天） | 复杂，Phase 3范围外 | |

**Auto-selected:** 双列分屏 — 与Phase 2 PreviewDrawer视觉语言一致，节点详情随时可见

---

## 聊天历史存储

| Option | Description | Selected |
|--------|-------------|----------|
| Zustand session-only（不持久化） | `nodeChats: Record<string, ChatMessage[]>` 不加入 partialize | ✓ |
| Zustand + localStorage（持久化） | 加入partialize，跨会话保留 | |
| 组件本地state | 切换节点即丢失 | |

**Auto-selected:** Session-only — PRST-02明确为v2需求，版本不升级

---

## AI完成信号

| Option | Description | Selected |
|--------|-------------|----------|
| state_patch扩展（`nodeComplete: boolean`） | 复用Phase 1 JSON解析模式，服务端在reply中嵌入 | ✓ |
| 纯文本检测（AI说"可以确认"） | 不可靠，误判率高 | |
| 服务端独立字段（`completion_rate >= 100`） | 已有completion_rate但针对全局需求，不适合per-node | |

**Auto-selected:** state_patch扩展 — 与Phase 1同一解析路径，最小新增复杂度

---

## 确认流程

| Option | Description | Selected |
|--------|-------------|----------|
| 按钮始终可见（AI建议时高亮） | 用户随时可确认，AI高亮提示 | ✓ |
| 仅AI建议后才出现确认按钮 | 更严格，但AI判断可能不准确 | |
| 确认对话框 | 二次确认，但增加摩擦 | |

**Auto-selected:** 始终可见 + AI高亮 — 用户主权，减少摩擦

---

## API端点设计

| Option | Description | Selected |
|--------|-------------|----------|
| POST JSON（与/api/chat一致） | 简单，立即返回完整回复 | ✓ |
| SSE流式响应 | 更好体验但增加复杂度 | |
| WebSocket | 过度设计 | |

**Auto-selected:** POST JSON — v1一致性，SSE可作v2增强

---

## Claude's Discretion

- 系统prompt的具体措辞
- ForgeChat的loading/error状态样式
- 确认按钮的高亮动效细节

## Deferred Ideas

- PRST-02: per-node聊天持久化 → v2
- 用户触发的跨节点引用picker → v2
- SSE流式响应 → v2增强
