# Quick Task 260602-f4c: PRD 拆解策略修正 - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Task Boundary

修正 PRD 拆解策略：大文档拆解需要更尊重原文；页面节点下继续按 MVC（model、ctrl、view）拆成子节点；导图页面节点前增加原文档标题/目录前置节点。

</domain>

<decisions>
## Implementation Decisions

### 原文目录前置节点
- 使用单个根节点承载原文目录：导图根节点为“原文目录/PRD 原文目录”，content 列出 Markdown 标题；页面节点挂在该根节点下面。

### MVC 子节点粒度
- MVC 子节点不强制固定三节点；只为原文明确涉及的 model、ctrl、view 部分生成子节点，避免空节点膨胀。缺失信息可在页面节点或已有 MVC 节点中标注“需澄清”。

### 原文保真策略
- 节点内容采用“引用+整理”：保留原文依据、行号/标题位置、关键原文摘录，再做简短结构化整理。

</decisions>

<specifics>
## Specific Ideas

目标导图结构：单个原文目录根节点 -> 页面节点 -> MVC 子节点。大文档分段流程仍对用户无感。

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements fully captured in decisions above.

</canonical_refs>
