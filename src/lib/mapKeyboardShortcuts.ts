export type MapShortcutAction =
  | 'save'
  | 'saveAs'
  | 'openArchive'
  | 'newProject'
  | 'exportSpec'
  | 'deleteNode'
  | 'cancelOrClose'
  | 'openDetail'
  | 'openForge'
  | 'smartArrange'
  | 'addNode'

export interface MapShortcutHelpItem {
  action: MapShortcutAction
  keys: string[]
  label: string
  description: string
  group: 'project' | 'canvas' | 'node'
}

export const MAP_SHORTCUT_HELP: MapShortcutHelpItem[] = [
  {
    action: 'save',
    keys: ['Ctrl+S', 'Cmd+S'],
    label: '保存项目存档',
    description: '保存当前导图内容和项目状态。',
    group: 'project',
  },
  {
    action: 'saveAs',
    keys: ['Ctrl+Shift+S', 'Cmd+Shift+S'],
    label: '另存为项目存档',
    description: '选择新位置保存当前项目存档。',
    group: 'project',
  },
  {
    action: 'openArchive',
    keys: ['Ctrl+O', 'Cmd+O'],
    label: '打开存档',
    description: '打开已有 UX SpecForge 项目存档。',
    group: 'project',
  },
  {
    action: 'newProject',
    keys: ['Ctrl+N', 'Cmd+N'],
    label: '新建项目',
    description: '清空当前工作区并开始新项目。',
    group: 'project',
  },
  {
    action: 'exportSpec',
    keys: ['Ctrl+E', 'Cmd+E'],
    label: '导出文档包',
    description: '导出当前导图的交互规格文档包。',
    group: 'project',
  },
  {
    action: 'cancelOrClose',
    keys: ['Esc'],
    label: '关闭当前浮层',
    description: '关闭连线、预览、面板或清除当前选择。',
    group: 'canvas',
  },
  {
    action: 'smartArrange',
    keys: ['Ctrl+Shift+F', 'Cmd+Shift+F'],
    label: '智能整理',
    description: '重新整理画布节点位置。',
    group: 'canvas',
  },
  {
    action: 'deleteNode',
    keys: ['Delete', 'Backspace'],
    label: '删除选中节点',
    description: '删除当前详情节点；没有详情时删除画布聚焦节点。',
    group: 'node',
  },
  {
    action: 'openDetail',
    keys: ['Enter'],
    label: '打开节点详情',
    description: '打开画布聚焦节点的右侧详情。',
    group: 'node',
  },
  {
    action: 'openForge',
    keys: ['F'],
    label: '进入 Deep Forge',
    description: '进入当前可交付节点的文档打磨界面。',
    group: 'node',
  },
  {
    action: 'addNode',
    keys: ['A'],
    label: '新增节点',
    description: '在当前聚焦/选中节点下新增页面节点；无节点时新增到画布。',
    group: 'node',
  },
]

export interface KeyboardShortcutEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  repeat?: boolean
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
}

export function resolveMapShortcut(
  event: KeyboardShortcutEventLike,
  targetIsEditable = false,
): MapShortcutAction | null {
  const key = event.key.toLowerCase()
  const hasPrimaryModifier = Boolean(event.ctrlKey || event.metaKey)
  const hasShift = Boolean(event.shiftKey)
  const hasAlt = Boolean(event.altKey)

  if (hasPrimaryModifier && !hasAlt && key === 's') return hasShift ? 'saveAs' : 'save'
  if (targetIsEditable || event.repeat || hasAlt) return null

  if (key === 'escape' && !hasPrimaryModifier && !hasShift) return 'cancelOrClose'

  if (hasPrimaryModifier) {
    if (hasShift && key === 'f') return 'smartArrange'
    if (hasShift) return null
    if (key === 'o') return 'openArchive'
    if (key === 'n') return 'newProject'
    if (key === 'e') return 'exportSpec'
    return null
  }

  if (hasShift) return null
  if (key === 'delete' || key === 'backspace') return 'deleteNode'
  if (key === 'enter') return 'openDetail'
  if (key === 'f') return 'openForge'
  if (key === 'a') return 'addNode'
  return null
}
