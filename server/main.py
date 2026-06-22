import json
import os

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url=os.environ.get("ANTHROPIC_BASE_URL"),
)

MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = """你是一个跨平台 UX 需求打磨助手，面向 H5、Android、iOS 或游戏客户端项目。

你的任务是通过对话帮助用户明确 UX 需求，并在每次回复中更新需求状态。

每次回复必须严格输出以下 JSON 格式，不要有任何其他内容：
{
  "reply": "你对用户的回复文本",
  "statePatch": {
    "trigger_condition": "触发条件描述，如未知则为 null",
    "sequence_rules": "执行顺序规则，如未知则为 null",
    "asset_dependencies": [
      {"type": "prefab|effect|audio|texture", "path": "资源路径或 null", "is_ready": true|false}
    ],
    "engine_constraints": "引擎限制和建议，如未知则为 null",
    "completion_rate": 0到100的整数,
    "slot_confidence": {
      "trigger_condition": 0到100,
      "sequence_rules": 0到100,
      "asset_dependencies": 0到100,
      "engine_constraints": 0到100
    },
    "missing_reasons": {
      "trigger_condition": "缺失原因或 null",
      "sequence_rules": "缺失原因或 null",
      "asset_dependencies": "缺失原因或 null",
      "engine_constraints": "缺失原因或 null"
    },
    "next_question": "下一个要问用户的问题，信息完整时为 null"
  }
}

规则：
- statePatch 必须包含所有字段，基于当前对话内容更新
- completion_rate 根据四个 slot 的置信度综合计算
- 每轮对话后更新置信度，已明确的 slot 置信度应 >= 80
- next_question 引导用户补充最关键的缺失信息
- reply 用中文，简洁专业"""


class ContentBlock(BaseModel):
    type: str
    text: str | None = None
    source: dict | None = None


class ChatMessage(BaseModel):
    role: str
    content: str | list[ContentBlock]


class AssetDependency(BaseModel):
    type: str
    path: str | None
    is_ready: bool


class SlotConfidence(BaseModel):
    trigger_condition: int
    sequence_rules: int
    asset_dependencies: int
    engine_constraints: int


class MissingReasons(BaseModel):
    trigger_condition: str | None
    sequence_rules: str | None
    asset_dependencies: str | None
    engine_constraints: str | None


class UXRequirementState(BaseModel):
    trigger_condition: str | None
    sequence_rules: str | None
    asset_dependencies: list[AssetDependency]
    engine_constraints: str | None
    completion_rate: int
    slot_confidence: SlotConfidence
    missing_reasons: MissingReasons
    next_question: str | None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    requirementState: UXRequirementState


class ProjectKnowledgeSearchRequest(BaseModel):
    query: str


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "claude": {
            "provider": "anthropic",
            "model": MODEL,
            "apiKeyPresent": bool(os.environ.get("ANTHROPIC_API_KEY")),
        },
        "projectKnowledge": {
            "mode": "local-in-memory-index",
            "status": "ready",
            "description": "Indexes the current project PRD source, nodes, evidence, contracts, and recent node-chat confirmations per request.",
        },
    }


@app.post("/api/chat")
def chat(req: ChatRequest):
    context = f"\n当前需求状态：\n{req.requirementState.model_dump_json(indent=2)}"
    messages = []
    for m in req.messages:
        if isinstance(m.content, str):
            content = m.content
            if m.role == "user" and m == req.messages[-1]:
                content += context
            messages.append({"role": m.role, "content": content})
        else:
            # ContentBlock[] — multimodal
            blocks = []
            for block in m.content:
                if block.type == "text":
                    text = block.text or ""
                    if m.role == "user" and m == req.messages[-1]:
                        text += context
                    blocks.append({"type": "text", "text": text})
                elif block.type == "image" and block.source:
                    blocks.append({"type": "image", "source": block.source})
            # If no text block was found, append context as new text block
            if m.role == "user" and m == req.messages[-1]:
                has_text = any(b["type"] == "text" for b in blocks)
                if not has_text:
                    blocks.append({"type": "text", "text": context})
            messages.append({"role": m.role, "content": blocks})

    response = client.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=messages,
    )

    raw = response.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    parsed = json.loads(raw)
    return {
        "reply": parsed["reply"],
        "statePatch": parsed["statePatch"],
        "usage": response.usage.model_dump() if response.usage else None,
    }


@app.post("/api/project-knowledge/search")
def project_knowledge_search(req: ProjectKnowledgeSearchRequest):
    # Stub — local project knowledge retrieval is implemented in the TypeScript Express server.
    return {
        "status": "connected",
        "answer": f"项目知识检索「{req.query}」请使用 TypeScript Express 服务，本备用服务仅返回占位结果。",
        "references": [],
    }
