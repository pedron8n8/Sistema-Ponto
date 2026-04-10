import { createRoot } from 'react-dom/client'
import './i18n'
import App from './App'
import './style.css'
import 'leaflet/dist/leaflet.css'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(<App />)
