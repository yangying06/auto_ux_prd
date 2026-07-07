/**
 * Chat message transformation helpers.
 *
 * Extracted from server/index.ts. Pure functions that convert between the
 * app's ChatMessage/ContentBlock types and Anthropic SDK message params.
 */
import Anthropic from '@anthropic-ai/sdk'

interface ContentBlock {
  type: 'text' | 'image' | 'document'
  title?: string
  context?: string
  text?: string
  source?: { type: 'base64' | 'text'; media_type: string; data: string }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.map((block) => {
    if (block.type === 'text') return block.text ?? ''
    if (block.type === 'document') {
      const title = block.title ? `附件：${block.title}` : '附件'
      const data = block.source?.data ?? ''
      return [title, block.context, data].filter(Boolean).join('\n')
    }
    return ''
  }).filter(Boolean).join('\n')
}


export function hasImages(content: string | ContentBlock[]) {
  return typeof content !== 'string' && content.some((b) => b.type === 'image' && b.source)
}


export function imageBlocksFromContent(content: string | ContentBlock[]): Anthropic.ImageBlockParam[] {
  if (typeof content === 'string') return []
  return content
    .filter((block): block is ContentBlock & { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } => (
      block.type === 'image' && block.source?.type === 'base64'
    ))
    .map((block) => ({ type: 'image', source: block.source as Anthropic.Base64ImageSource }))
}


export function imageBlocksFromMessages(messages: ChatMessage[]): Anthropic.ImageBlockParam[] {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => imageBlocksFromContent(message.content))
}


export function toAnthropicNodeMessage(message: ChatMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }

  if (message.role === 'assistant') {
    return { role: message.role, content: extractText(message.content) }
  }

  const content = message.content
    .map((block): Anthropic.ContentBlockParam | null => {
      if (block.type === 'text') return { type: 'text', text: block.text ?? '' }
      if (block.type === 'image' && block.source?.type === 'base64') {
        return { type: 'image', source: block.source as Anthropic.Base64ImageSource }
      }
      if (block.type === 'document' && block.source?.type === 'text') {
        return {
          type: 'document',
          title: block.title ?? null,
          context: block.context ?? null,
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: block.source.data,
          },
        }
      }
      return null
    })
    .filter((block): block is Anthropic.ContentBlockParam => Boolean(block))

  return {
    role: message.role,
    content: content.length > 0 ? content : extractText(message.content),
  }
}


export function prependTextToUserMessage(message: ChatMessage, prefix: string): ChatMessage {
  if (typeof message.content === 'string') {
    return {
      role: 'user',
      content: `${prefix}\n\n${message.content}`,
    }
  }

  let didPrepend = false
  const content = message.content.map((block) => {
    if (block.type !== 'text' || didPrepend) return block
    didPrepend = true
    return {
      ...block,
      text: `${prefix}\n\n${block.text ?? ''}`,
    }
  })

  return {
    role: 'user',
    content: didPrepend
      ? content
      : [{ type: 'text', text: prefix }, ...content],
  }
}
