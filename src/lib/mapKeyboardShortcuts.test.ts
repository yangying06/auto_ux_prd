import { MAP_SHORTCUT_HELP, resolveMapShortcut } from './mapKeyboardShortcuts'

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

assertEqual(resolveMapShortcut({ key: 's', ctrlKey: true }, true), 'save', 'Ctrl+S saves even from editable fields')
assertEqual(resolveMapShortcut({ key: 'S', metaKey: true, shiftKey: true }, true), 'saveAs', 'Cmd+Shift+S saves as')
assertEqual(resolveMapShortcut({ key: 'Delete' }, false), 'deleteNode', 'Delete removes the active node')
assertEqual(resolveMapShortcut({ key: 'Backspace' }, false), 'deleteNode', 'Backspace also removes the active node outside editors')
assertEqual(resolveMapShortcut({ key: 'Delete' }, true), null, 'Delete is ignored while editing text')
assertEqual(resolveMapShortcut({ key: 'Escape' }, false), 'cancelOrClose', 'Escape closes the active layer')
assertEqual(resolveMapShortcut({ key: 'o', ctrlKey: true }, false), 'openArchive', 'Ctrl+O opens an archive')
assertEqual(resolveMapShortcut({ key: 'n', ctrlKey: true }, false), 'newProject', 'Ctrl+N creates a project')
assertEqual(resolveMapShortcut({ key: 'e', ctrlKey: true }, false), 'exportSpec', 'Ctrl+E exports specs')
assertEqual(resolveMapShortcut({ key: 'f', ctrlKey: true, shiftKey: true }, false), 'smartArrange', 'Ctrl+Shift+F smart-arranges the canvas')
assertEqual(resolveMapShortcut({ key: 'Enter' }, false), 'openDetail', 'Enter opens details for the focused node')
assertEqual(resolveMapShortcut({ key: 'f' }, false), 'openForge', 'F opens Deep Forge for the focused node')
assertEqual(resolveMapShortcut({ key: 'a' }, false), 'addNode', 'A opens add-node flow')
assertEqual(resolveMapShortcut({ key: 'a' }, true), null, 'single-key shortcuts are ignored while editing text')
assertEqual(resolveMapShortcut({ key: 'e', ctrlKey: true, repeat: true }, false), null, 'repeat keydown does not rerun non-save actions')

const helpByAction = new Map(MAP_SHORTCUT_HELP.map((item) => [item.action, item]))
assertEqual(helpByAction.get('save')?.keys.includes('Ctrl+S'), true, 'shortcut help lists Ctrl+S save')
assertEqual(helpByAction.get('deleteNode')?.keys.includes('Delete'), true, 'shortcut help lists Delete node removal')
assertEqual(helpByAction.get('openForge')?.keys.includes('F'), true, 'shortcut help lists Forge shortcut')
assertEqual(new Set(MAP_SHORTCUT_HELP.map((item) => item.action)).size, MAP_SHORTCUT_HELP.length, 'shortcut help actions are unique')

console.log('mapKeyboardShortcuts.test.ts: all assertions passed')
