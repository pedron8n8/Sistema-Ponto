import { useEffect, useState } from 'react'
import LoadingScreen from './LoadingScreen'
import { subscribeGlobalLoading } from '../lib/loading'

const SHOW_DELAY_MS = 200

const GlobalLoadingOverlay = () => {
  const [activeCount, setActiveCount] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    return subscribeGlobalLoading(setActiveCount)
  }, [])

  useEffect(() => {
    if (activeCount <= 0) {
      setVisible(false)
      return
    }

    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeCount])

  if (!visible) {
    return null
  }

  return <LoadingScreen />
}

export default GlobalLoadingOverlay
