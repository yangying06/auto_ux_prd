# 原型生成「截图转代码 + 多变体迭代」改造计划

> 文档目的：把 GameUX PromptForge 的「打磨界面预览」原型生成机制，对齐到 `D:\learn\abi-screenshot-to-code`（screenshot-to-code）的能力模型——**基于参考图生成、同时产出多个界面变体、选其一进入迭代、流式推送**。
>
> 撰写日期：2026-05-29
> 分析方式：并行双 Agent 源码梳理（当前仓库 + abi-screenshot-to-code）
> 适用范围：`server/index.ts` 的 `/api/prototype`、前端原型预览组件、Zustand store、原型相关类型

---

## 一、问题诊断：为什么"原型不像参考图"

经过对当前系统的全链路梳理，确认了用户反馈的根因：

### 1.1 参考图根本没有进入原型生成 API

| API | 是否接收参考图 | 说明 |
|-----|--------------|------|
| `POST /api/chat`（四槽需求打磨） | ✅ 是（仅最后一条 user 的图） | 用于需求识别 |
| `POST /api/node-chat`（节点文档打磨） | ✅ 是（全历史多模态） | 用于文档精修 |
| **`POST /api/prototype`（原型生成）** | ❌ **否** | **只把 `UXRequirementState` 文本化** |

证据（`src/lib/api.ts`）：

```50:68:src/lib/api.ts
export interface PrototypeResponse {
  html: string
  mode: 'create' | 'update' | 'rewrite'
  appliedEdits: number
}

export function generatePrototype(
  baseUrl: string,
  requirementState: UXRequirementState,
  options: { currentHtml?: string | null; instruction?: string } = {},
) {
  return requestJson<PrototypeResponse>(baseUrl, '/api/prototype', {
    method: 'POST',
    body: JSON.stringify({
      requirementState,
      currentHtml: options.currentHtml ?? null,
      instruction: options.instruction ?? null,
    }),
  })
}
```

请求体里**没有任何 image 字段**。服务端 `buildCreatePrototypePrompt()` 也只接收 `requirementState`，发给 Claude 的 `messages` 是纯文本：

```1640:1651:server/index.ts
  const isUpdate = Boolean(normalizedCurrentHtml && updateInstruction)
  const prompt = isUpdate
    ? buildUpdatePrototypePrompt(requirementState, normalizedCurrentHtml!, updateInstruction)
    : buildCreatePrototypePrompt(requirementState)

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    tools: isUpdate ? [editPrototypeTool] : undefined,
    messages: [{ role: 'user', content: prompt }],
  })
```

**结论**：参考图只能通过"对话 → 文本化需求 → 原型"的间接链路影响结果，等价于"让 AI 凭文字描述凭空画"，与"看着截图还原"完全是两回事。这是原型不像参考图的**第一根因**。

### 1.2 当前没有"多变体"概念

- `/api/prototype` 响应只有单个 `html` 字段。
- 全库没有 `variants` / `candidates` / `NUM_VARIANTS` 等概念。
- `prototypeHistory`（`appStore.ts`）是**串行迭代版本**（最多 8 条），不是"同一轮并行的多个方案"。
- Create prompt 明确要求"只输出单个完整 HTML 文件"。

### 1.3 当前是同步非流式

- `/api/prototype` 是一次性 `await anthropic.messages.create(...)`，无 `stream`、无 SSE、无 WebSocket。
- 长 HTML 生成期间前端无任何进度反馈。

---

## 二、对照：abi-screenshot-to-code 的能力模型

| 能力维度 | abi-screenshot-to-code | 当前 PromptForge |
|---------|------------------------|------------------|
| 参考图传给模型 | ✅ data URL 数组直接进 `image_url` | ❌ 不传 |
| 多变体并行 | ✅ 创建 4 个 / 更新 2 个，`asyncio.gather` | ❌ 单个 |
| 多模型对比 | ✅ 按 API Key 轮换不同模型 | ❌ 单模型 |
| 流式推送 | ✅ WebSocket，`setCode` 增量 | ❌ 同步 await |
| 选择变体 | ✅ Variants 网格 + Alt+1..9 切换 | ❌ 无 |
| 迭代/编辑 | ✅ 选中 variant 上 `edit_file` 局部改 | ⚠️ 有 `edit_prototype` 但无变体 |
| 版本模型 | ✅ Commit 链 + per-variant history | ⚠️ 全局单 `prototypeHtml` + 串行历史 |
| 通信协议 | WebSocket 单连接多路复用 | HTTP JSON |

**关键机制（要对齐的精髓，而非逐行抄 UI）：**

1. **图片直传**：前端把参考图编码成 data URL，作为 `image` block 直接喂给视觉模型。
2. **WebSocket + variantIndex 多路复用**：一条连接同时推送 N 个变体的流式代码。
3. **Commit / Variant 数据模型**：每次生成是一次快照（Commit），含多个 variant；只有被选中的 variant 才继承对话 history 进入下一轮。
4. **创建 N 个 / 更新 M 个**：创建时多样性优先（4 个），更新时成本优先（2 个）。
5. **Agent + create_file / edit_file**：流式 `setCode` + 结构化局部编辑，而非纯文本 markdown 整段重写。
6. **per-variant history**：每个变体维护独立对话历史，避免多变体串线。

---

## 三、目标架构

### 3.1 数据流总览（改造后）

```
用户在 Forge 节点选定参考图（reference 角色）
  ↓ 已是 base64 / data URL（ForgeChat 已支持上传）
  ↓ 点击「生成原型」
  ↓ 前端 openPrototypeStream(WebSocket)  ← 新增
  ↓ ws.send({ requirementState, images[], stack, generationType:'create', numVariants:N })
  ↓ 服务端 fan-out：为每个 variant 起一个并行任务（Promise.all）
  ↓     每个任务 anthropic.messages.stream(...) 带 image blocks
  ↓     流式 chunk → ws.send({ type:'setCode', variantIndex, html })
  ↓ 前端 PrototypeVariants 网格：N 个手机框 iframe 实时预览
  ↓ 用户点选某个 variant 作为「选中方案」
  ↓ 输入修改指令 → generationType:'update'，仅对选中 variant 的 html + history 迭代（M 个变体）
  ↓ 新一轮 Commit，parentHash 指向上一轮
```

### 3.2 与 abi 的差异取舍（务实裁剪）

| abi 做法 | 本项目建议 | 理由 |
|---------|-----------|------|
| Python FastAPI 后端 | **保留 Express + `@anthropic-ai/sdk`** | 不引入 Python 运行时，符合技术栈约束 |
| 多 Provider（OpenAI/Gemini/Claude） | **只用 Claude**，多变体靠"同模型多次采样 + 不同 temperature/视角提示" | 约束要求继续用 Anthropic |
| WebSocket | **WebSocket（`ws` 库）或 SSE** | 见 §5.1 选型 |
| Commit 链完整版本树 | **简化为 per-node 的 variant 列表 + 选中态** | 单文档场景，无需完整 DAG |
| `asyncio.gather` | **`Promise.all` / `Promise.allSettled`** | Node 并发 |

> 说明：abi 的"多变体多样性"很大程度来自**不同模型**。本项目只用 Claude，多样性需要靠**提示工程**补足：给每个 variant 注入不同的"设计侧重"提示（如 variant A 信息密度优先、variant B 视觉冲击优先、variant C 严格还原参考图布局），并适当调高 `temperature`。这是本改造的关键风险点（见 §7）。

---

## 四、详细改造计划（分阶段）

### Phase 0 — 让参考图进入原型生成（最高 ROI，1–2 天）

> **这是解决"原型不像参考图"的核心，必须最先做。** 即使不做多变体和流式，仅此一步就能让结果质变。

**任务清单：**

1. **类型扩展** `src/lib/api.ts`：
   - `generatePrototype` 的 `options` 增加 `images?: ContentBlock[]`（或 `ImageRef[]`）。
   - 请求体加入 `images` 字段。

2. **前端取图** `src/pages/ForgePage.tsx` → `handleGeneratePrototype`：
   - 从当前节点对话 `messages` 中抽取所有 `image` block（优先 `reference` 角色），透传给 `generatePrototype`。
   - 复用 `ForgeChat` 已有的 base64 组装逻辑。

3. **服务端接收 + 注入** `server/index.ts` `/api/prototype` 处理器：
   - 解析 `req.body.images`，转成 `Anthropic.ImageBlockParam[]`。
   - 修改 `messages` 构造：`content: [...imageBlocks, { type:'text', text: prompt }]`。

4. **Prompt 改写** `buildCreatePrototypePrompt()`：
   - 增加截图还原纪律（借鉴 abi `prompts/create/image.py`）：
     - "严格按照参考图的布局、配色、文案、间距还原"
     - "忽略截图中的对比外壳、手机边框、评审批注等捕获伪影"
     - "参考图用于视觉还原，需求状态 JSON 用于补充交互逻辑与约束"
   - 明确"参考图优先级高于文字猜测"。

**验收标准：** 上传一张参考图 → 生成的原型在布局/配色/文案上肉眼可辨地接近参考图，而非凭空生成。

---

### Phase 1 — 多变体并行生成（核心能力，3–5 天）

**任务清单：**

1. **服务端 fan-out** `server/index.ts`：
   - `/api/prototype` 增加 `numVariants`（默认创建 4 / 更新 2）。
   - 为每个 variant 构造略有差异的 prompt（注入"设计侧重"），用 `Promise.allSettled` 并行调用 Claude。
   - 每个 variant 设置不同 `temperature`（如 0.4 / 0.7 / 0.9 / 1.0）增加多样性。
   - 响应结构改为 `{ variants: Array<{ index, html, mode, model, status }> }`。
   - 失败的 variant 单独标记 `status:'error'`，不拖累其他。

2. **新增"设计侧重"提示集**（`server/index.ts` 或新 `server/prototypePrompts.ts`）：
   ```
   VARIANT_FOCUS = [
     '严格还原参考图的布局与视觉层级',
     '在还原基础上优化信息密度与可读性',
     '强调视觉冲击与品质感（阴影/渐变/微交互）',
     '移动端紧凑布局优先（375px 安全区）',
   ]
   ```

3. **类型** `src/types/`：新增 `PrototypeVariant`：
   ```ts
   interface PrototypeVariant {
     index: number
     html: string | null
     status: 'pending' | 'streaming' | 'complete' | 'error'
     model?: string
     focus?: string
   }
   ```

4. **Store** `src/store/appStore.ts`：
   - 新增 `prototypeVariants: PrototypeVariant[]` 与 `selectedVariantIndex: number`。
   - 选中某 variant 时把它的 html 同步到既有 `prototypeHtml`（保持下游导出兼容）。

**验收标准：** 点一次"生成原型"，得到 4 个不同风格的候选 HTML，互不相同。

---

### Phase 2 — 变体选择 UI（2–3 天）

**任务清单：**

1. **新组件** `src/components/state/PrototypeVariants.tsx`：
   - 2×2 网格，每格一个 `sandbox.html` iframe 缩略预览（复用现有 `postMessage` hydrate 机制）。
   - 点击某格 → `setSelectedVariantIndex`，高亮选中。
   - 支持 `Alt+1..4` 快捷切换（借鉴 abi）。
   - 选中态下"放大"为主预览（沿用 `PrototypeBoard`）。

2. **改造** `PrototypeBoard.tsx` / `ForgeChat.tsx`：
   - 生成阶段展示 `PrototypeVariants` 网格；
   - 选定后切换为单一大预览 + 迭代输入框。

3. **空/加载/错误态**：pending 显示骨架，error 显示重试按钮（仅重跑该 variant）。

**验收标准：** 网格能并排预览所有候选，点选切换流畅，选中项进入主预览。

---

### Phase 3 — 选中变体的迭代（2–3 天）

> 当前已有 `edit_prototype` 工具，但只作用于全局单 HTML。改造为"只对选中 variant 迭代"。

**任务清单：**

1. **迭代请求**：迭代时 `generationType:'update'`，请求体带：
   - 选中 variant 的 `currentHtml`；
   - 该 variant 的 `instruction`（用户修改指令）；
   - 可选：参考图（继续作为视觉参照）。
   - `numVariants` 改为 2（更新时成本优先，参考 abi）。

2. **per-variant 历史**：
   - 选中 variant 维护自己的对话历史（指令序列），迭代时重放，避免串线。
   - 数据落在 `PrototypeVariant.history?: ChatMessage[]`。

3. **服务端 update 路径**：沿用现有 `edit_prototype` 工具优先、rewrite 兜底逻辑（`applyPrototypeToolUses`），但作用对象是选中 variant 的 html。

4. **新 Commit 语义**：每次迭代后，选中 variant 更新为新结果，旧结果入 `prototypeHistory`（保留可回退）。

**验收标准：** 选中一个变体后连续 3 轮对话式修改，每次只动目标元素，其余保持不变；其他未选中变体不受影响。

---

### Phase 4 — 流式推送（体验提升，3–5 天）

> 可选但强烈推荐。多变体并行 + 同步等待会让用户盯着空白等很久，流式能显著改善体感。

**任务清单：**

1. **协议选型**（见 §5.1）：建议 **SSE**（改动小，单向推送够用）或 `ws`（双向、更贴近 abi）。

2. **服务端流式**：
   - 把 `anthropic.messages.create` 换成 `anthropic.messages.stream`。
   - 每个 variant 的 `text` delta → 推送 `{ type:'setCode', variantIndex, htmlSoFar }`。
   - variant 完成 → `{ type:'variantComplete', variantIndex }`。

3. **前端接收**：
   - 新 `src/lib/prototypeStream.ts` 封装连接与事件分发。
   - 收到 `setCode` → 更新对应 variant 的 html → iframe 实时 re-hydrate。

**验收标准：** 4 个变体的预览随生成过程逐步浮现，而非全部空白后突然出现。

---

## 五、关键技术决策

### 5.1 通信协议：SSE vs WebSocket

| 维度 | SSE | WebSocket（`ws`） |
|-----|-----|------------------|
| 方向 | 单向（够用：服务端推流） | 双向 |
| Express 集成 | 简单（`res.write`） | 需挂 `ws` 到 http server |
| 多变体多路 | 一个 SSE 流里用 `variantIndex` 区分 | 同上 |
| 与 abi 一致性 | 低 | 高 |
| 改造成本 | **低** | 中 |

**建议**：Phase 4 先用 **SSE**（请求仍是 POST 触发，响应 `text/event-stream`），保持 Express 简单。若后续要做"点选元素编辑"等双向交互再升级 WebSocket。

> 注意 Tauri webview 对 SSE/WebSocket 的兼容性需在桌面壳里单测（当前 CSP 为 null，应无阻碍，但需验证）。

### 5.2 多变体多样性来源（只用 Claude 的补偿策略）

abi 的多样性来自不同模型；本项目只用 Claude，需靠：
- **不同 `temperature`**（0.4 / 0.7 / 0.9 / 1.0）。
- **不同"设计侧重"系统提示**（§Phase 1）。
- 可选：不同 `CLAUDE_MODEL`（若环境配置了 sonnet/opus 两个模型）。

### 5.3 持久化与体积

- 多变体 HTML 体积大，**不建议全部持久化到 localStorage**（已接近配额风险）。
- 建议：只持久化"选中 variant 的 html"（即现有 `prototypeHtml`）+ 串行历史；未选中的候选仅存内存。
- 参考图同样不落 localStorage（现状已是 `[图片附件]` 占位），需评估迭代时是否每轮重传。

### 5.4 兼容性：保持导出链路不变

- 下游 `/api/export-prompt`、bolt 外链等依赖全局 `prototypeHtml`。
- 改造原则：**选中 variant 始终同步写入 `prototypeHtml`**，使导出、StateCanvas 等无需改动。

---

## 六、改动文件清单（速查）

| 阶段 | 文件 | 改动 |
|-----|------|------|
| P0 | `src/lib/api.ts` | `generatePrototype` 加 `images` |
| P0 | `src/pages/ForgePage.tsx` | 取节点参考图透传 |
| P0 | `server/index.ts` | `/api/prototype` 注入 image blocks + 改 prompt |
| P1 | `server/index.ts` / 新 `server/prototypePrompts.ts` | fan-out + 设计侧重提示集 |
| P1 | `src/types/*`（新 `prototypeVariant.ts`） | `PrototypeVariant` 类型 |
| P1 | `src/store/appStore.ts` | `prototypeVariants` + `selectedVariantIndex` |
| P2 | 新 `src/components/state/PrototypeVariants.tsx` | 变体网格 UI |
| P2 | `src/components/state/PrototypeBoard.tsx` | 选中态主预览切换 |
| P2 | `src/components/map/ForgeChat.tsx` | 接入变体网格 |
| P3 | `server/index.ts` | update 路径作用于选中 variant + per-variant history |
| P4 | `server/index.ts` | `messages.stream` + SSE 推送 |
| P4 | 新 `src/lib/prototypeStream.ts` | 前端流式接收 |
| 复用 | `public/sandbox.html`、`src/lib/prototypeUtils.ts` | 无需改动（沿用 hydrate/normalize） |

---

## 七、风险与缓解

| 风险 | 影响 | 缓解 |
|-----|------|------|
| 只用 Claude，4 个变体相似度高 | 多变体意义打折 | 强化"设计侧重"提示 + 拉开 temperature；必要时配置第二个模型 |
| 4 路并行调用成本/限流 | API 费用、429 | 默认值可调（设置项）；`Promise.allSettled` 容错；失败单独重试 |
| 参考图 + 多变体 → 请求体大 | 10mb body limit、延迟 | 图片仅 create 首轮传；update 可不重传或传缩略 |
| localStorage 配额 | 持久化失败 | 仅持久化选中 variant；候选存内存 |
| 流式 + Express 复杂度 | 开发成本 | Phase 4 可延后；先做 P0–P3 同步版 |
| Tauri webview SSE/iframe 兼容 | 桌面端异常 | 桌面壳单独冒烟测试 |
| `edit_prototype` 字符串替换偶发不匹配 | 迭代失败 | 已有 rewrite 兜底，保留 |

---

## 八、推荐执行顺序与里程碑

| 里程碑 | 包含阶段 | 工作量 | 交付价值 |
|-------|---------|--------|----------|
| **M1：原型像参考图** | P0 | 1–2 天 | 解决核心痛点，立竿见影 |
| **M2：多变体可选** | P1 + P2 | 5–8 天 | 对齐 abi 的"多界面选一个" |
| **M3：选中迭代** | P3 | 2–3 天 | 闭环：选一个 → 持续打磨 |
| **M4：流式体验** | P4 | 3–5 天 | 体验对齐 abi，体感顺滑 |

> **最小可用闭环 = M1 + M2 + M3**（约 2 周）。M4 为体验增强，可按反馈决定投入。

---

## 九、与既有文档的关系

- 本文档是 `docs/ai-prototype-integration-proposal.md`（2026-05-27，跨 4 项目的宏观集成建议）的**聚焦落地版**——只针对 screenshot-to-code 的「多变体 + 参考图还原 + 迭代」能力，给出当前仓库的具体改造路径。
- 两者不冲突：宏观提案的 Phase 1（prompt/解析管线）可与本文 P0 合并；本文补齐了宏观提案缺失的"参考图直传"与"多变体"两块。

---

## 附录：abi-screenshot-to-code 关键参考位置

| 机制 | 源码位置（`D:\learn\abi-screenshot-to-code`） |
|-----|----------------------------------------------|
| 图片注入 model | `backend/prompts/create/image.py` |
| 多变体并行 | `backend/routes/generate_code.py`（`process_variants` / `asyncio.gather`） |
| 变体数量配置 | `backend/config.py`（`NUM_VARIANTS=4` / `NUM_VARIANTS_VIDEO=2`） |
| 模型轮换 | `backend/routes/model_choice_sets.py` |
| Prompt 分流 | `backend/prompts/pipeline.py` |
| update 策略 | `backend/prompts/update/from_history.py` / `from_file_snapshot.py` |
| Agent 流式 | `backend/agent/engine.py` |
| 前端 WS 客户端 | `frontend/src/generateCode.ts` |
| 前端编排 | `frontend/src/App.tsx`（`doCreate` / `doUpdate`） |
| 变体 UI | `frontend/src/components/variants/Variants.tsx` |
| 状态模型 | `frontend/src/store/project-store.ts`（Commit + Variant） |
