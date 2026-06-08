import type { ChatMessage, ContentBlock } from '../types/chat'

const IMAGE_OMITTED_NOTE = '图片证据已在本次会话中使用；为避免本地存储超限，图片二进制数据未持久化。'

function persistableContentBlocks(content: ContentBlock[]): ContentBlock[] {
  const textBlocks = content
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map((block) => ({ ...block }))
  const imageCount = content.filter((block) => block.type === 'image').length

  if (imageCount === 0) return textBlocks

  return [
    ...textBlocks,
    {
      type: 'text',
      text: `[${imageCount} 张${IMAGE_OMITTED_NOTE}]`,
    },
  ]
}

export function persistableMessage(message: ChatMessage): ChatMessage {
  if (typeof message.content === 'string') return { ...message }
  return {
    ...message,
    content: persistableContentBlocks(message.content),
  }
}

export function persistableMessages(messages: ChatMessage[], limit?: number): ChatMessage[] {
  const source = typeof limit === 'number' ? messages.slice(-limit) : messages
  return source.map(persistableMessage)
}

export function persistableNodeChats(nodeChats: Record<string, ChatMessage[]>, limit?: number) {
  return Object.fromEntries(
    Object.entries(nodeChats).map(([nodeId, messages]) => [
      nodeId,
      persistableMessages(messages, limit),
    ]),
  )
}
