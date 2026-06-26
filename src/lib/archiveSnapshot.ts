import type { AppStoreState } from '../store/appStore'
import type { ProjectWorkspaceSnapshot } from '../types/archive'
import { persistableMessages, persistableNodeChats } from './messagePersistence'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createProjectWorkspaceSnapshot(state: AppStoreState): ProjectWorkspaceSnapshot {
  return cloneJson({
    requirement: state.requirement,
    messages: persistableMessages(state.messages),
    latestRag: state.latestRag,
    prototypeHtml: state.prototypeHtml,
    prototypeHistory: state.prototypeHistory,
    prototypeVariants: state.prototypeVariants,
    selectedVariantIndex: state.selectedVariantIndex,
    nodePrototypeStates: state.nodePrototypeStates,
    settings: state.settings,
    prdTree: state.prdTree,
    selectedNodeId: state.selectedNodeId,
    canvasNodePositions: state.canvasNodePositions,
    nodeChats: persistableNodeChats(state.nodeChats),
    nodePolishRevisions: state.nodePolishRevisions,
    nodeOperationSuggestions: state.nodeOperationSuggestions,
    qaIssues: state.qaIssues,
    mapAdjustmentMessages: persistableMessages(state.mapAdjustmentMessages),
    pendingMapAdjustmentOperations: state.pendingMapAdjustmentOperations,
    assetWorkbench: state.assetWorkbench,
    sourceDocument: state.sourceDocument,
    projectWorkflow: state.projectWorkflow,
  })
}
