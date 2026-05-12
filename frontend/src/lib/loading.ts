type LoadingListener = (count: number) => void

let activeCount = 0
let globalLoadingEnabled = true
const listeners = new Set<LoadingListener>()

const notifyListeners = () => {
  listeners.forEach((listener) => listener(activeCount))
}

export const subscribeGlobalLoading = (listener: LoadingListener) => {
  listeners.add(listener)
  listener(activeCount)

  return () => {
    listeners.delete(listener)
  }
}

export const startGlobalLoading = () => {
  if (!globalLoadingEnabled) {
    return
  }

  activeCount += 1
  notifyListeners()
}

export const stopGlobalLoading = () => {
  if (!globalLoadingEnabled) {
    return
  }

  activeCount = Math.max(0, activeCount - 1)
  notifyListeners()

  if (activeCount === 0) {
    globalLoadingEnabled = false
  }
}
