import type { ChatMessage, ImageBlock } from '../types/chat'

interface FigmaPrototypeEvidence {
  panelName: string
  imageCount: number
  images?: Array<{
    numericTextSlots?: Array<unknown>
  }>
}

function imageBlocks(content: ChatMessage['content']): ImageBlock[] {
  if (typeof content === 'string') return []
  return content.filter((block): block is ImageBlock => block.type === 'image')
}

function textBlocks(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') return [`附件：${block.title}`, block.context, block.source.data].filter(Boolean).join('\n')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function buildFigmaPrototypeIterationInstruction(result: FigmaPrototypeEvidence, hasExistingPrototype: boolean) {
  const action = hasExistingPrototype ? '增量更新当前右侧 HTML 原型' : '生成右侧 HTML 原型'
  const numericSlotCount = result.images?.reduce((sum, image) => sum + (image.numericTextSlots?.length ?? 0), 0) ?? 0
  return [
    `根据刚导入的 Figma Frame「${result.panelName}」${action}。`,
    `本次有 ${result.imageCount} 张 Figma 视觉证据，必须真实用于界面图片、素材、布局、层级、颜色和控件位置。`,
    numericSlotCount ? `本次 Figma 子图中已去除 ${numericSlotCount} 处示例数值；必须按证据里的数值占位坐标在 HTML 中叠加真实业务数值或动态占位，不要恢复 Figma 示例数字。` : null,
    '如果用户本轮要求替换 item 图片或素材，优先替换对应 UI 画面，不要改写需求文档。',
  ].filter(Boolean).join('\n')
}

export function mergeInstructionIntoPrototypeEvidence(
  instruction: string | null | undefined,
  evidenceContent: ChatMessage['content'] | undefined,
): ChatMessage['content'] | undefined {
  const trimmedInstruction = instruction?.trim()
  if (!trimmedInstruction) return evidenceContent

  const instructionText = `用户本轮 UI 迭代要求：\n${trimmedInstruction}`
  if (!evidenceContent) return instructionText

  const evidenceText = textBlocks(evidenceContent)
  const images = imageBlocks(evidenceContent)
  if (!images.length) {
    return [instructionText, evidenceText].filter(Boolean).join('\n\n')
  }

  return [
    {
      type: 'text',
      text: [instructionText, evidenceText].filter(Boolean).join('\n\n'),
    },
    ...images,
  ]
}
