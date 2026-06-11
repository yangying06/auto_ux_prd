import type { ChatMessage, ImageBlock } from '../types/chat'

const FIGMA_URL_PATTERN = /https?:\/\/(?:www\.)?figma\.com\/[^\s，。；;）)\]}]+/iu
const FIGMA_URL_GLOBAL_PATTERN = /https?:\/\/(?:www\.)?figma\.com\/[^\s，。；;）)\]}]+/giu

const VISUAL_OBJECT_PATTERN = /(figma|ui|界面|原型|预览|视觉|设计稿|参考图|截图|图片|图像|素材|贴图|item|道具|图标|icon|按钮|button|卡片|列表|弹窗|背景|头像|banner|logo|颜色|布局|间距|层级|位置|尺寸|字号|字体)/iu

const UI_ACTION_PATTERN = /(换|替换|换成|改成|改为|改一下|修改|调整|更新|迭代|对齐|修复|优化|使用|套用|放大|缩小|移动|挪|删掉|隐藏|显示|加上|替换为)/u

const DOCUMENT_UPDATE_PATTERN = /((需求文档|文档|prd|spec|规格|验收|规则|逻辑|流程|接口|字段|配置|数据|埋点|服务端|后端).{0,12}(更新|修改|补充|记录|写|写入|完善|加上|加入))|((更新|修改|补充|记录|写入|完善|加上|加入).{0,12}(需求文档|文档|prd|spec|规格|验收|规则|逻辑|流程|接口|字段|配置|数据|埋点|服务端|后端))/iu

const DOCUMENT_NEGATION_PATTERN = /(不要|不能|别|无需|不需要).{0,10}(改|更新|修改|写入|记录|动).{0,10}(需求|文档|prd|spec|规格)/iu

function textBlocks(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') {
        return [`附件：${block.title}`, block.context, block.source.data].filter(Boolean).join('\n')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function chatContentText(content: ChatMessage['content']) {
  return textBlocks(content).trim()
}

export function chatContentImages(content: ChatMessage['content']): ImageBlock[] {
  if (typeof content === 'string') return []
  return content.filter((block): block is ImageBlock => block.type === 'image')
}

export function extractFigmaUrlFromText(text: string) {
  return extractFigmaUrlsFromText(text)[0] ?? null
}

export function extractFigmaUrlsFromText(text: string) {
  const urls = new Set<string>()
  for (const match of text.matchAll(FIGMA_URL_GLOBAL_PATTERN)) {
    const url = match[0].replace(/[，。；;,.）)\]}]+$/u, '')
    if (url) urls.add(url)
  }
  return Array.from(urls)
}

export function hasExplicitDocumentUpdateRequest(text: string) {
  return DOCUMENT_UPDATE_PATTERN.test(text) && !DOCUMENT_NEGATION_PATTERN.test(text)
}

export function isUiOnlyPrototypeText(text: string, hasImages = false) {
  const trimmed = text.trim()
  const hasFigmaUrl = FIGMA_URL_PATTERN.test(trimmed)
  const hasVisualObject = VISUAL_OBJECT_PATTERN.test(trimmed)
  const hasUiAction = UI_ACTION_PATTERN.test(trimmed)
  const explicitDocumentUpdate = hasExplicitDocumentUpdateRequest(trimmed)

  if (explicitDocumentUpdate) return false
  if (hasFigmaUrl) return true
  if (hasImages && (hasVisualObject || hasUiAction)) return true
  return hasVisualObject && hasUiAction
}

export function isUiOnlyPrototypeFeedback(content: ChatMessage['content']) {
  return isUiOnlyPrototypeText(chatContentText(content), chatContentImages(content).length > 0)
}

export function buildUiOnlyPrototypeInstruction(content: ChatMessage['content']) {
  const text = chatContentText(content)
  if (text) return `按本轮用户反馈迭代右侧 UI 原型：${text}`
  return '根据本轮图片证据迭代右侧 UI 原型，优先替换对应图片、素材、布局和视觉层级。'
}
