const activePrototypeControllers = new Map<string, AbortController>()

export function getActivePrototypeGenerationController(nodeId: string | null | undefined) {
  if (!nodeId) return null
  const controller = activePrototypeControllers.get(nodeId)
  if (!controller) return null
  if (controller.signal.aborted) {
    activePrototypeControllers.delete(nodeId)
    return null
  }
  return controller
}

export function beginPrototypeGeneration(nodeId: string) {
  if (getActivePrototypeGenerationController(nodeId)) return null
  const controller = new AbortController()
  activePrototypeControllers.set(nodeId, controller)
  return controller
}

export function clearPrototypeGeneration(nodeId: string, controller: AbortController) {
  if (activePrototypeControllers.get(nodeId) === controller) {
    activePrototypeControllers.delete(nodeId)
  }
}

export function cancelPrototypeGeneration(nodeId: string | null | undefined) {
  const controller = getActivePrototypeGenerationController(nodeId)
  if (!controller) return false
  controller.abort()
  return true
}

