import type { ChatMessage } from '../types/chat'

export interface RemovedChatTurn {
  messages: ChatMessage[]
  recalledMessage: ChatMessage | null
}

export function findLatestUserMessageIndex(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

export function removeLatestUserTurn(messages: ChatMessage[]): RemovedChatTurn {
  const userMessageIndex = findLatestUserMessageIndex(messages)
  if (userMessageIndex === -1) {
    return { messages, recalledMessage: null }
  }

  return {
    messages: messages.slice(0, userMessageIndex),
    recalledMessage: messages[userMessageIndex],
  }
}

export function getTextFromMessage(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') return [`附件：${block.title}`, block.context].filter(Boolean).join('\n')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
