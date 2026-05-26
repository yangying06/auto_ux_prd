# Requirements: GameUX PromptForge — PRD文档拆解导图

**Defined:** 2026-05-26
**Core Value:** 将模糊的PRD文档转化为精确的、经过逐节点确认的交互设计规格

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: App supports two routes: map view (/) and forge view (/forge/:nodeId)
- [x] **INFRA-02**: Zustand store扩展支持PrdTree flat node map和per-node chat state
- [x] **INFRA-03**: Store version从3迁移到4，含migrate函数
- [x] **INFRA-04**: Express body limit提升到10MB支持大文档上传

### Upload

- [x] **UPLD-01**: User can upload a Markdown file via drag-and-drop or file picker
- [x] **UPLD-02**: Upload displays progress indicator and status feedback
- [x] **UPLD-03**: AI拆解过程中显示拆解进度（streaming或阶段反馈）

### Decomposition

- [x] **DCMP-01**: Server通过Claude tool-use API将MD文档拆解为结构化树JSON
- [x] **DCMP-02**: AI按职能/模块自动分层拆解（不依赖Markdown heading层级）
- [x] **DCMP-03**: normalizeDecompositionTree()验证器保证返回数据结构有效
- [x] **DCMP-04**: 拆解结果存储为flat node map (Record<id, PrdNode>)

### Mindmap

- [ ] **MAP-01**: markmap SVG渲染文档树结构
- [ ] **MAP-02**: React overlay层显示节点状态badge（未处理/已完成）
- [ ] **MAP-03**: 缩放/平移/适配控件
- [ ] **MAP-04**: 节点展开/收起动画效果
- [ ] **MAP-05**: 暗色主题适配（Forge Blueprint设计系统）
- [ ] **MAP-06**: setData()调用时保持当前缩放位置不重置

### Preview

- [ ] **PRVW-01**: 单击节点打开右侧预览drawer面板
- [ ] **PRVW-02**: 预览面板显示节点摘要内容和技术实现备注
- [ ] **PRVW-03**: 预览面板含"Enter Deep Forge"按钮导航到forge view
- [ ] **PRVW-04**: 节点卡片显示ID标识（如PL-01, CE-04）

### Forge

- [ ] **FORG-01**: 每个节点拥有独立的聊天历史记录
- [ ] **FORG-02**: ChatPanel和StateCanvas通过props接收node context（不直接读全局store）
- [ ] **FORG-03**: AI评估需求完成度并建议确认
- [ ] **FORG-04**: User可手动确认节点完成
- [ ] **FORG-05**: 节点确认完成后自动跳回map视图
- [ ] **FORG-06**: Forge中可引用其他节点内容作为上下文
- [ ] **FORG-07**: Server提供/api/node-chat端点，注入节点内容到prompt

### Export

- [ ] **EXPT-01**: 导出按钮在所有节点完成前保持disabled（门禁检查）
- [ ] **EXPT-02**: 每个完成的叶子节点生成一份Markdown spec文档
- [ ] **EXPT-03**: 打包为zip压缩包供用户下载
- [ ] **EXPT-04**: Zip内目录结构对应树的层级结构

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Document Processing

- **DOCP-01**: 集成marker实现PDF/Word→Markdown自动转换
- **DOCP-02**: 支持多文档同时管理和切换

### Advanced Map

- **AMAP-01**: 小地图导航辅助
- **AMAP-02**: 手动拖拽调整节点结构
- **AMAP-03**: 用户自定义拆解规则/模板

### Persistence

- **PRST-01**: 迁移到Tauri文件系统持久化
- **PRST-02**: Per-node聊天历史持久化（IndexedDB）

## Out of Scope

| Feature | Reason |
|---------|--------|
| marker PDF转换集成 | 减少复杂度，用户手动预处理MD |
| 多文档同时管理 | 单文档模式，MVP够用 |
| 实时协作/多人编辑 | 单人工具，不需要 |
| 非UI节点的打磨流程 | 只处理UI交互节点 |
| 手动编辑节点结构 | 范围膨胀风险，内容编辑在Forge中完成 |
| 移动端适配 | 桌面优先 |
| markmap内注入React元素 | 技术反模式，D3/React DOM冲突 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| UPLD-01 | Phase 1 | Complete |
| UPLD-02 | Phase 1 | Complete |
| UPLD-03 | Phase 1 | Complete |
| DCMP-01 | Phase 1 | Complete |
| DCMP-02 | Phase 1 | Complete |
| DCMP-03 | Phase 1 | Complete |
| DCMP-04 | Phase 1 | Complete |
| MAP-01 | Phase 2 | Pending |
| MAP-02 | Phase 2 | Pending |
| MAP-03 | Phase 2 | Pending |
| MAP-04 | Phase 2 | Pending |
| MAP-05 | Phase 2 | Pending |
| MAP-06 | Phase 2 | Pending |
| PRVW-01 | Phase 2 | Pending |
| PRVW-02 | Phase 2 | Pending |
| PRVW-03 | Phase 2 | Pending |
| PRVW-04 | Phase 2 | Pending |
| FORG-01 | Phase 3 | Pending |
| FORG-02 | Phase 3 | Pending |
| FORG-03 | Phase 3 | Pending |
| FORG-04 | Phase 3 | Pending |
| FORG-05 | Phase 3 | Pending |
| FORG-06 | Phase 3 | Pending |
| FORG-07 | Phase 3 | Pending |
| EXPT-01 | Phase 4 | Pending |
| EXPT-02 | Phase 4 | Pending |
| EXPT-03 | Phase 4 | Pending |
| EXPT-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-26*
*Last updated: 2026-05-26 after roadmap creation*
