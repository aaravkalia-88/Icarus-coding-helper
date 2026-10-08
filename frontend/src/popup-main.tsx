import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Popup from './Popup'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

const root = document.getElementById('root')

if (!root) throw new Error('ICARUS popup root is missing')

createRoot(root, { onCaughtError: ErrorBoundary.reportError }).render(
  <StrictMode>
    <ErrorBoundary popup><Popup /></ErrorBoundary>
  </StrictMode>,
)
