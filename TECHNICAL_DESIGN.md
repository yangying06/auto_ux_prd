# GameUX PromptForge 技术设计文档

## 1. 项目概述

**GameUX PromptForge** 是一款面向游戏 UX 设计师和开发者的 AI 辅助需求打磨工具。通过结构化对话，将模糊的游戏交互描述逐步转化为 Cocos Creator 3.8.8 可实施的工程级 UX Prompt。

### 1.1 核心价值

- 将非结构化的口语描述转化为引擎可落地的结构化需求
- 通过 RAG 接入 Cocos Creator 文档，确保需求描述符合引擎约束
- 实时可视化需求完整度，降低沟通成本
- 生成 HTML 白盒原型，快速验证交互逻辑

### 1.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端 | React + Vite + TailwindCSS | SPA，支持 Tauri 打包为桌面端 |
| 状态管理 | Zustand (persist) | 轻量、支持 localStorage 持久化 |
| 后端代理 | Express + TypeScript | 本地代理，隔离 API Key |
| AI 模型 | Claude (Anthropic SDK) | Tool Use 驱动的多轮对话 |
| 知识库 | Cocos RAG MCP SSE | 通过 MCP 协议接入远程知识库 |
| 桌面封装 | Tauri 2.x | 可选，Windows 桌面发行 |

---

## 2. 需求分析

### 2.1 用户角色

- **游戏 UX 设计师**：用自然语言描述交互意图，不一定了解引擎 API
- **前端/客户端开发者**：需要明确的 trigger、sequence、asset 信息来落地实现

### 2.2 核心需求

#### R1: 结构化需求收集

系统需将用户的自由描述拆解为 4 个核心 Slot：

| Slot | 含义 | 示例 |
|------|------|------|
| `trigger_condition` | 触发条件 | "玩家点击背包按钮" |
| `sequence_rules` | 执行时序 | "先缩放 0.9x → 弹出面板 → 播放音效" |
| `asset_dependencies` | 资源依赖 | prefab 路径、音效文件、spine 动画 |
| `engine_constraints` | 引擎约束 | "需使用 Tween 系统, node.active 控制显隐" |

#### R2: 智能追问

- 每轮最多追问 1 个高价值问题
- 仅在信息不足以阻塞实现时追问
- 完成率 >= 60% 后停止追问，直接输出最终 Prompt

#### R3: 实时状态可视化

- 进度条反映需求完整度 (0-100%)
- 每个 Slot 以卡片形式展示填充状态和置信度
- 缺失 Slot 以红色虚线边框高亮

#### R4: Cocos RAG 知识增强

- 当用户描述涉及引擎概念时，自动查询 Cocos 3.8.8 文档
- 检索结果作为 engine_constraints 的权威依据

#### R5: 白盒原型生成

- 完成率 >= 60% 时开放原型生成入口
- 生成自包含 HTML 页面，用 CSS 动画模拟交互流程
- 在 iframe sandbox 中安全预览

---

## 3. 系统架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │  ChatPanel   │  │         StateCanvas              │ │
│  │  (35% width) │  │         (65% width)              │ │
│  │              │  │  ┌────────────────────────────┐  │ │
│  │  - 消息列表  │  │  │    PrototypeBoard (45%)    │  │ │
│  │  - 输入框    │  │  │    iframe sandbox preview  │  │ │
│  │  - 附件上传  │  │  ├────────────────────────────┤  │ │
│  │  - 撤回操作  │  │  │    StateCards (55%)        │  │ │
│  │              │  │  │    触发/资源/时序/引擎      │  │ │
│  └──────────────┘  │  └────────────────────────────┘  │ │
│                     └──────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │ HTTP (localhost:8787)
┌────────────────────────────▼────────────────────────────┐
│                  Local Proxy (Express)                   │
│                                                         │
│  /api/chat ──────────────► Claude API (Tool Use Loop)   │
│  /api/rag/search ────────► Cocos RAG MCP SSE Proxy      │
│  /api/prototype ─────────► Claude API (单轮生成)        │
│  /api/health ────────────► 状态自检                     │
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐          ┌─────────────────────┐
│  Anthropic API  │          │  Cocos RAG Server   │
│  (Claude Model) │          │  (MCP SSE 远程)     │
└─────────────────┘          └─────────────────────┘
```

### 3.2 数据流设计

```
用户输入 → ChatPanel.handleSend()
         → POST /api/chat { messages, requirementState }
         → runClaudeRequirementLoop()
              ├── Claude 判断是否需要工具调用
              ├── [可选] query_cocos_knowledge → MCP SSE → RAG 结果
              └── Claude 返回 { reply, state_patch }
         → normalizeStatePatch() 数据清洗
         → 返回 { reply, statePatch, rag }
         → applyRequirementPatch() 更新 Zustand Store
         → StateCanvas 重新渲染
```

---

## 4. 核心设计决策

### 4.1 Slot-Based 需求建模

**设计哲学**：将开放式 UX 描述约束为有限状态机。

```typescript
interface UXRequirementState {
  trigger_condition: string | null    // 单一字符串描述触发
  sequence_rules: string | null       // 时序规则文字描述
  asset_dependencies: AssetDependency[] // 结构化资源列表
  engine_constraints: string | null   // 引擎层面约束
  completion_rate: number             // 0-100 综合完成度
  slot_confidence: SlotConfidence     // 各 Slot 独立置信度
  missing_reasons: MissingReasons     // 各 Slot 缺失原因
  next_question: string | null        // AI 推荐的下一个问题
}
```

**为什么选择 4-Slot 模型：**

1. **trigger_condition** — 回答 "What triggers it?"，对应引擎事件/输入系统
2. **sequence_rules** — 回答 "What happens next?"，对应 Tween/动画队列
3. **asset_dependencies** — 回答 "What assets are needed?"，对应预制体/音效/特效
4. **engine_constraints** — 回答 "Any engine-level gotchas?"，由 RAG 补充

这 4 个维度覆盖了从设计意图到工程实现的最小必要信息集。

### 4.2 Claude Tool Use 循环

**设计选择**：使用 Tool Use 而非简单的单轮 Chat。

```
while (stop_reason !== 'end_turn') {
    response = claude.messages.create({ tools, messages })
    if (tool_use blocks exist) {
        execute tool → append tool_result → continue loop
    }
}
```

**好处**：
- Claude 自主决定何时需要查询 RAG（而非每轮都查）
- 工具调用结果融入上下文，Claude 可综合判断
- 未来可扩展更多工具（如 asset validator、prefab linter）

### 4.3 结构化 JSON 输出协议

Claude 每轮返回固定 JSON 结构：

```json
{
  "reply": "面向用户的自然语言回复",
  "state_patch": {
    "trigger_condition": "...",
    "completion_rate": 45,
    "slot_confidence": { ... },
    "next_question": "..."
  }
}
```

**设计考量**：
- `reply` 与 `state_patch` 分离：前者渲染为聊天气泡，后者驱动状态面板
- Patch 语义（非全量替换）：只更新有变化的字段，减少 AI 幻觉带来的状态回退
- 严格的归一化层 (`normalizeStatePatch`)：防止 Claude 输出越界值

### 4.4 Proxy 架构（API Key 隔离）

```
Browser ←→ localhost:8787 ←→ Anthropic API
                           ←→ Cocos RAG MCP
```

**为什么不在前端直接调 API：**
- API Key 不应暴露在浏览器环境
- MCP SSE 代理需要 `spawn` 子进程（浏览器无法执行）
- 便于日后替换模型或增加中间件（缓存、限流）

### 4.5 MCP 协议接入 Cocos RAG

```
Express Server
  → spawn('uv', ['run', 'remote_proxy.py', sseUrl])
  → JSON-RPC over stdin/stdout
  → tools/call { name: 'search_cocos_docs', arguments: { query, version } }
  → 返回文档片段
```

**设计权衡**：
- 选择 per-request spawn 而非长连接：简化状态管理，避免连接泄漏
- 代价是每次查询有 ~1-2s 冷启动开销
- 后续优化方向：连接池或 WebSocket 长连接

### 4.6 前端状态持久化

```typescript
create<AppStoreState>()(
  persist(store, {
    name: 'gameux-promptforge-state',
    version: 2,
    partialize: (state) => ({
      requirement, messages, latestRag, settings
    }),
  })
)
```

**决策**：
- 使用 Zustand persist 到 localStorage
- `prototypeHtml` 不持久化（体积大、可重新生成）
- 版本号 (`version: 2`) 控制 schema migration

---

## 5. 前端组件设计

### 5.1 组件树

```
App
└── AppShell
    ├── ChatPanel (35% 左侧)
    │   ├── Header (标题 + 连接状态)
    │   ├── MessageList (消息流)
    │   └── InputArea (输入 + 附件 + 发送)
    ├── StateCanvas (65% 右侧)
    │   ├── Header (进度条 + 操作按钮)
    │   ├── PrototypeBoard (iframe 预览)
    │   └── StateCards (Slot 卡片网格)
    │       ├── StateCard[trigger_condition]
    │       ├── StateCard[asset_dependencies]
    │       ├── StateCard[sequence_rules]
    │       ├── StateCard[engine_constraints]
    │       ├── StateCard[next_question]
    │       └── StateCard[rag_references]
    └── SettingsPanel (侧滑面板)
```

### 5.2 StateCard 多态设计

单一组件通过 `tone` 属性切换三种视觉状态：

| tone | 含义 | 视觉特征 |
|------|------|----------|
| `complete` | Slot 已填充 | 绿色边框 + glow |
| `missing` | Slot 缺失 | 红色虚线 + pulse 动画 |
| `info` | 辅助信息 | 蓝色边框 |

### 5.3 多模态输入

ChatPanel 支持：
- 纯文本输入
- 图片附件 (base64 inline，传入 Claude Vision)
- 文本文件附件 (内联为 code block)
- 撤回最后一条消息

---

## 6. 后端 API 设计

### 6.1 端点一览

| Method | Path | 功能 | 请求体 |
|--------|------|------|--------|
| GET | `/api/health` | 服务自检 | - |
| POST | `/api/chat` | AI 对话 + 状态更新 | `{ messages, requirementState }` |
| POST | `/api/rag/search` | 独立 RAG 查询 | `{ query }` |
| POST | `/api/prototype` | 原型 HTML 生成 | `{ requirementState }` |

### 6.2 /api/chat 处理流程

1. **关键词预热**：若用户消息匹配 `cocos|tween|动画|引擎` 等关键词，先行触发 RAG 查询
2. **Tool Use 循环**：调用 Claude API，支持多轮工具调用
3. **JSON 解析**：容错解析 Claude 输出（支持被文字包裹的 JSON）
4. **状态归一化**：clamp 数值、dedupe 资源、null 化空字符串
5. **响应合并**：返回 reply + statePatch + rag

### 6.3 数据归一化策略

```typescript
// 防止 Claude 输出 "unknown" 或 "待定" 等无意义字符串
normalizeNullableString("待定") → null

// 资源去重（按 type:path 组合键）
dedupeAssets([...]) → unique assets

// 数值钳位
clampCompletionRate(120, fallback) → 100
clampConfidence(-5, fallback)     → 0
```

---

## 7. 关键设计约束

### 7.1 安全性

- API Key 仅存在于 server/.env，不编译进前端
- CORS 白名单限制为 `localhost:5173`
- Prototype iframe 使用 `sandbox="allow-scripts"` 限制权限
- Express body-parser 限制 1MB 防止大请求攻击

### 7.2 可靠性

- `safeParseClaudeJson`：多候选策略解析 Claude 的非标 JSON 输出
- Tool Use 超时后返回 fallback 错误信息而非 crash
- 前端 error boundary 在消息流中内联显示错误

### 7.3 性能

- Zustand persist 的 `partialize` 避免存储无需持久化的大数据
- MCP 子进程按需启动、用完即销毁，不占常驻内存
- Prototype 生成使用独立端点，不阻塞主 chat 流

---

## 8. 未来演进方向

| 方向 | 描述 | 优先级 |
|------|------|--------|
| Streaming 输出 | Chat 回复使用 SSE 流式显示 | P1 |
| RAG 连接池 | MCP 长连接复用，降低查询延迟 | P1 |
| Export Final Prompt | 将完成的需求导出为标准 Cocos 实现 Prompt | P2 |
| 多项目管理 | 支持切换不同游戏项目的需求上下文 | P2 |
| 协作模式 | 多人同时编辑同一需求文档 | P3 |
| 历史版本 | 需求状态的时间线回溯 | P3 |
