import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './Landing'
import ErrorBoundary from './ErrorBoundary'
import './index.css'

const root = document.getElementById('root')

if (!root) throw new Error('ICARUS renderer root is missing')

createRoot(root, { onCaughtError: ErrorBoundary.reportError }).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
)
