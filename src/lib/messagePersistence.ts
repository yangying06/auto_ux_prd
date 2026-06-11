import type { ChatMessage, ContentBlock } from '../types/chat'

const IMAGE_OMITTED_NOTE = 'Image evidence was used in this turn; binary image data was not persisted locally.'
const DOCUMENT_OMITTED_NOTE = 'Document attachment was sent to AI in this turn; body omitted from local persistence.'

function persistableContentBlocks(content: ContentBlock[]): ContentBlock[] {
  const textBlocks = content
    .filter((block): block is ContentBlock & { type: 'text' } => block.type === 'text')
    .map((block) => ({ ...block }))
  const documentBlocks = content
    .filter((block): block is ContentBlock & { type: 'document' } => block.type === 'document')
    .map((block) => ({
      type: 'document' as const,
      title: block.title,
      context: block.context,
      source: {
        type: 'text' as const,
        media_type: 'text/plain' as const,
        data: DOCUMENT_OMITTED_NOTE,
      },
    }))
  const imageCount = content.filter((block) => block.type === 'image').length

  if (imageCount === 0) return [...textBlocks, ...documentBlocks]

  return [
    ...textBlocks,
    ...documentBlocks,
    {
      type: 'text',
      text: `[${imageCount} image attachment(s) omitted: ${IMAGE_OMITTED_NOTE}]`,
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
