# AI 原型生成工具集成优化建议

> 文档目的：基于对 4 个开源项目的深度考察，为 GameUX PromptForge 提供具体可执行的集成路径与优先级建议。
>
> 考察日期：2026-05-27
> 考察方式：并行多 Agent 分析 + 源码爬取

---

## 一、项目背景与集成目标

**GameUX PromptForge 当前能力：**
- PRD 文档 → AI 驱动的 slot-filling 对话（`UXRequirementState` 四槽模型）
- `prototypeHtml` 字段存储 AI 生成的单文件 HTML 原型（不持久化）
- Express 代理 Claude API，SSE 流式输出
- Markdown 导出（含 spec 结构）

**集成目标（按优先级）：**
1. **提升原型预览质量** — 让生成的原型 HTML 更健壮、渲染更安全
2. **支持原型迭代** — 用户可对已生成的原型进行对话式修改
3. **版本历史管理** — 记录每轮打磨的 spec 快照，支持回退
4. **可运行原型验证** — 导出完成后，可一键生成完整可运行的交互原型

---

## 二、考察项目总览

| 项目 | Stars | License | 核心价值 | 集成角色 |
|------|-------|---------|----------|---------|
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) | 72.7k | MIT ✅ | 精工 Prompt 策略 + agentic edit_file 工具 | **Prompt 策略参考 + 工具调用模式** |
| [wandb/openui](https://github.com/wandb/openui) | 22.3k | Apache 2.0 ✅ | iframe 沙箱渲染 + 章节版本管理 + 视觉标注 | **前端组件模式直接借用** |
| [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | 19.4k | MIT ✅ | 完整可运行应用生成 + spec→prompt 转换 | **导出终态验证出口** |
| [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) | 29.9k | AGPL-3.0 ⚠️ | 离线 Prompt 优化实验台 + 对比评估 | **开发工具（非集成进产品）** |

---

## 三、项目深度分析

### 3.1 abi/screenshot-to-code

**架构：** Python FastAPI 后端 + React/Vite 前端，WebSocket 实时流式传输。核心是一个 `Pipeline + Middleware` 链，支持最多 20 步 agentic loop。

**核心 Prompt 策略：**
- AI 角色定义为"前端专家 + 工具调用代理"，代码修改强制走工具，禁止在 chat 消息中输出原始 HTML
- **Create/Update 双路径**：首次生成用 `create_from_input`；有历史时用 `update_from_history`（重放完整对话）；有文件快照时用 `update_from_file_snapshot`
- Stack 感知的 CDN 注入（Tailwind + React UMD + Babel Standalone），生成可独立运行的单文件 HTML

**迭代机制：** `edit_file` 工具执行精确字符串替换而非全文件重写，局部修改效率极高。多变体并行生成（同时生成 2-3 版本供选择）。

**对 PromptForge 的直接价值：**
- `system_prompt.py` 中的 Tailwind CDN 模板 + 单文件可运行约束，可直接替换现有 prototype generation prompt
- Create/Update 双路径映射：`prototypeHtml`（文件快照）+ `messages`（对话历史）已完备，只缺路由逻辑
- `edit_file` 工具可作为新的 Claude `tool_use` 定义加入 `server/index.ts`，实现原型局部修改

**风险：**
- 后端是 Python/FastAPI，不能直接 fork；应仅提取 Prompt 策略和数据结构，不复用运行时代码
- `edit_file` 字符串替换在 AI 生成代码中偶发空白字符不匹配，需加 fallback（降级全文件重写）

---

### 3.2 wandb/openui

**架构：** Python FastAPI 后端 + TypeScript/React 前端，`remark-parse` 解析 LLM 输出的 Markdown+Frontmatter 协议，iframe 沙箱渲染。

**UI 生成核心机制：**
- LLM 输出格式：带 `name/emoji` frontmatter 的 Markdown，HTML 在代码块中
- `parseMarkdown()` → `fixHTML()` → `wrappedCode()` 管线：自动处理 LLM 在 HTML 前后加 prose 描述的情况，注入 Tailwind CDN + shadcn 色彩变量
- iframe 沙箱通过 `postMessage` 协议接收 `{ action: 'hydrate', html, js, darkMode }` 消息，与主应用完全 CSS/JS 隔离

**迭代机制：**
- **文字迭代**：组装 `Given the following HTML:\n{currentHTML}\n{query}` 发给 LLM，新版 HTML 追加为新 chapter
- **视觉标注迭代（HtmlAnnotator）**：用户在 iframe 中点击元素，注入 `<!--FIX (N): 描述-->` 注释，LLM 按注释执行局部修改
- **版本历史**：`ItemWrapper` 管理 chapter 数组，版本号 `0,1,2...` 对应 LLM 生成轮次，`0.1,1.1...` 对应手动编辑，通过 URL hash `#vN` 导航

**对 PromptForge 的直接价值：**
- `wrappedCode()` + `parseMarkdown()` 约 120 行 TypeScript，零额外依赖可直接复制到 `src/lib/`，替换现有 prototypeHtml 生成逻辑
- iframe sandbox + `public/sandbox.html` 约 50 行，可立即替换现有内联渲染，获得 JS/CSS 隔离
- Chapter 版本机制可为每个 UX 节点的 AI 打磨过程维护历史快照，支持回退

**风险：**
- `remark-parse` + `unified` 需加入依赖（约 40KB），需验证 Vite 构建兼容性（预计无问题）
- Tauri webview（WKWebView）对 iframe `sandbox` + `postMessage` 的兼容性需单独验证，无现有参考实现

---

### 3.3 stackblitz-labs/bolt.diy

**架构：** Remix v2 + WebContainer（StackBlitz 专有 WASM Node.js 运行时），`boltAction` XML 格式驱动文件写入和 shell 命令，支持 15+ LLM 提供商。

**核心机制：**
- system prompt 分为 `<system_constraints>/<artifact_instructions>/<design_instructions>` 等 XML 块，强制要求 AI 输出完整文件内容（不允许截断）
- 文件树通过 `computeFileModifications()` 序列化为 `<bolt_file_modifications>` XML 注入上下文，AI 理解当前项目状态后输出增量变更
- 增量迭代：对 `modifiedFiles` 计算 unified diff，若 diff 更小则发 diff，否则发完整文件；AI 始终输出完整文件内容（WebContainer 不支持原生 patch 命令）

**spec → prompt 转换路径：**
```
UXRequirementState JSON
  → specToPrompt() 函数格式化
  → "基于以下交互规格生成可运行HTML原型: UI组件树[...] 触发条件[...] 序列规则[...]"
  → 作为 bolt.diy 第一条用户消息
```

支持通过 URL 参数传入初始 prompt：`https://bolt.new/?prompt=<encoded>`

**集成路径（由浅入深）：**
- 层级 1（外链跳转）：`window.open('https://bolt.new/?prompt=...')`，半天实现，零维护
- 层级 2（本地 iframe 嵌入）：自托管 bolt.diy + iframe 嵌入到 AppShell，加入 concurrently 一起启动
- 层级 3（深度集成）：移植 `StreamingMessageParser` + `ActionRunner` 核心逻辑到 Express 架构

**风险：**
- `@webcontainer/api` 是 StackBlitz 商业产品，生产环境需要授权；强依赖 `SharedArrayBuffer`（需 COOP/COEP 响应头）
- Tauri webview 的 COEP 兼容性存在差异，层级 3 在 Tauri 中需要额外配置
- 适合"纯前端 HTML/CSS/JS 原型"，不适合"真实游戏引擎运行原型"

---

### 3.4 linshenkx/prompt-optimizer（参考工具）

**架构：** TypeScript monorepo（`@prompt-optimizer/core` + Vue 3 前端），License 为 **AGPL-3.0**（商业使用需开源，不建议直接集成）。

**核心能力：**
- 多轮迭代优化：`optimize-system-prompt` → `iterate-prompt` 形成版本链（`chainId + version`）
- 对比评估：用同一批测试用例跑优化前/后的 prompt，由 LLM judge 打分裁决
- 变量模板：`ContextPackage` 结构 + `{{variableName}}` 语法，将固定 prompt 结构与可变输入分离
- MCP 工具暴露：可被 Claude Desktop 直接调用（`optimize-system-prompt`、`iterate-prompt`）

**对 PromptForge 的参考价值：**
1. **方法论借鉴**：把 `server/index.ts` 里的 system prompt 丢进 prompt-optimizer 跑优化，评估维度（角色定义清晰度、指令层次、约束完整性、输出规范性）与四槽结构高度对应
2. **completion_rate 可信度改进**：参考其对比评估机制，增加一个"独立审查者"Claude 调用，对 `UXRequirementState` 进行交叉核验，而非依赖模型自评
3. **变量模板参考**：将 system prompt 中的槽描述重构为 `{{trigger_condition_desc}}` 等变量，支持不同 PRD 类型（战斗/商城/新手引导）加载不同槽描述集

**不建议直接集成的原因：**
- AGPL-3.0 license 的 copyleft 传染性可能影响商业化路径
- 前端为 Vue 3 + Pinia，与 React + Zustand 栈不兼容，UI 组件无法复用
- 设计目标是"静态 prompt 文本的离线优化"，而 PromptForge 的 prompt 是运行时动态构建的，两者目标性质不同

**推荐使用方式：** 本地 Docker 启动（`docker run -d -p 8081:80 linshen/prompt-optimizer`），作为离线优化工作台，不集成进产品代码。

---

## 四、集成优先级矩阵

| 集成项 | 来源项目 | 价值 | 成本 | 优先级 |
|--------|---------|------|------|--------|
| 替换 prototype generation system prompt（Tailwind CDN 模板）| screenshot-to-code | 高 | 极低（<50行，1天）| **P0** |
| `wrappedCode()` + `parseMarkdown()` 工具函数 | openui | 高 | 极低（复制约120行，0.5天）| **P0** |
| Create/Update 双路径 prompt 路由 | screenshot-to-code | 高 | 低（3-4天）| **P1** |
| iframe 沙箱渲染 + `sandbox.html` | openui | 中高 | 低（2-3天）| **P1** |
| `edit_prototype` Claude tool（精确字符串替换）| screenshot-to-code | 中高 | 低（3-4天，含P1）| **P1** |
| "在 bolt.diy 中打开"外链按钮 | bolt.diy | 中 | 极低（半天）| **P2** |
| Chapter 版本历史 + 节点回退 | openui | 中 | 中（5-8天）| **P2** |
| 视觉标注迭代（HtmlAnnotator `<!--FIX-->` 模式）| openui | 中 | 中（3-4天）| **P2** |
| 自托管 bolt.diy iframe 嵌入 | bolt.diy | 中 | 中（3-5天）| **P3** |
| system prompt 对比评估机制 | prompt-optimizer 方法论 | 中 | 中（3-5天）| **P3** |

---

## 五、推荐执行路径

### Phase 1 — 立即可做（2-3天，零架构风险）

**目标：** 提升现有原型预览质量，修复 LLM 输出 prose 包裹导致渲染异常的问题。

```
1. 从 openui 复制 parseMarkdown() + wrappedCode() 到 src/lib/prototypeUtils.ts
2. 替换 server/index.ts 的 prototype generation system prompt
   → 引入 screenshot-to-code 的 Tailwind CDN 注入规范
   → 加入"单文件可运行"约束，禁止生成需要构建步骤的代码
3. 前端 prototypeHtml 渲染改用 parseMarkdown() → wrappedCode() 管线处理
```

验证标准：生成 5 个不同类型的 UI 节点原型，无渲染报错，Tailwind 样式正确加载。

---

### Phase 2 — 核心迭代能力（1周）

**目标：** 支持对已生成原型的对话式修改，不再每次全量重生成。

```
1. server/index.ts 新增 edit_prototype tool 定义：
   { name: "edit_prototype", input_schema: { old_string: string, new_string: string } }
2. 实现 Create/Update 路由逻辑：
   - 无 prototypeHtml → create_from_input（现有逻辑）
   - 有 prototypeHtml + 用户修改指令 → update_from_file_snapshot
     （将当前 prototypeHtml 内容注入 prompt，触发 edit_prototype tool）
3. iframe sandbox 替换（sandbox.html + postMessage hydrate）
4. 前端 ChatPanel 新增"编辑原型"入口，区分生成/修改两种模式
```

验证标准：对同一 UX 节点进行 3 轮对话式修改，每次只改动目标元素，其余 HTML 保持不变。

---

### Phase 3 — 导出验证出口（0.5天）

**目标：** 完成 spec 导出后，提供"可运行原型验证"出口。

```
1. 在 AppShell 导出区域新增"在 bolt.diy 中验证"按钮
2. 实现 specToPrompt(requirement: UXRequirementState): string：
   将四槽数据格式化为结构化自然语言 prompt
3. window.open('https://bolt.new/?prompt=' + encodeURIComponent(prompt), '_blank')
```

验证标准：点击按钮后，bolt.new 能接收 spec prompt 并生成对应的可运行 HTML 原型。

---

### Phase 4 — 进阶能力（按需）

以下为 V2 特性，根据用户反馈决定是否投入：

- **节点版本历史**：openui Chapter 模式，为每次 AI 打磨保存快照，支持回退
- **视觉标注迭代**：用户在原型上点击元素，输入修改说明，AI 执行局部修改
- **自托管 bolt.diy 嵌入**：将 bolt.diy 作为本地服务内嵌到 PromptForge，原型预览无需离开工具

---

## 六、技术实现备注

### 关键代码参考位置

| 参考点 | 源码位置 |
|--------|---------|
| Tailwind CDN system prompt | `abi/screenshot-to-code/backend/prompts/system_prompt.py` |
| Create/Update 路由逻辑 | `abi/screenshot-to-code/backend/prompts/pipeline.py` → `derive_prompt_construction_plan()` |
| parseMarkdown + wrappedCode | `wandb/openui/frontend/src/lib/` |
| iframe sandbox 通信协议 | `wandb/openui/openui/public/openui/index.html` |
| spec→prompt URL 参数格式 | `stackblitz-labs/bolt.diy/app/components/chat/PromptInput.tsx` |
| boltAction XML system prompt | `stackblitz-labs/bolt.diy/app/lib/.server/llm/system-prompt.ts` |

### License 兼容性确认

| 项目 | License | 商业使用 | 集成方式 |
|------|---------|---------|---------|
| abi/screenshot-to-code | MIT | ✅ 无限制 | 借鉴 Prompt 策略（不引入 Python 代码） |
| wandb/openui | Apache 2.0 | ✅ 无限制 | 复制 TypeScript 工具函数（需保留版权声明） |
| stackblitz-labs/bolt.diy | MIT | ✅ 无限制（WebContainer API 另行授权）| 外链集成（不引入 WebContainer API） |
| linshenkx/prompt-optimizer | AGPL-3.0 | ⚠️ 需开源 | **不集成进代码**，仅作离线工具使用 |

### prompt-optimizer 实际使用建议

```bash
# 本地启动离线优化工作台
docker run -d -p 8081:80 \
  -e VITE_OPENAI_API_KEY=<your-key> \
  linshen/prompt-optimizer

# 访问 http://localhost:8081
# 将 server/index.ts 中的 buildSystemPrompt() 输出粘贴到"系统提示词优化"页面
# 选择 "optimize" 模板跑优化，再用 "iterate" 针对已知问题（slot_confidence 虚高等）定向改进
# 用同一批 PRD 测试用例对比优化前后的 completion_rate 分布
```

---

## 七、总结

| 阶段 | 工作量 | 收益 |
|------|--------|------|
| Phase 1（Prompt + 解析管线）| 2-3 天 | 原型生成质量立即提升，渲染稳定性增强 |
| Phase 2（对话式迭代 + iframe 沙箱）| 1 周 | 核心迭代能力，设计师可对原型进行局部修改 |
| Phase 3（bolt.diy 外链出口）| 0.5 天 | 完整可运行验证闭环，几乎零成本 |
| Phase 4（版本历史 + 视觉标注）| 1-2 周 | V2 高级功能，按需评估 |

**最高 ROI 的起点：** Phase 1 中的 `wrappedCode()` + system prompt 替换，约 1.5 天工作量，直接解决现有原型预览质量问题，且完全无架构风险。
