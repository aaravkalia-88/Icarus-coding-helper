import { ProviderConnection } from './App'
import './App.css'

export default function Models() {
  return (
    <div className="app-shell models-shell">
      <header className="app-header"><div className="brand"><span className="brand-name">ICARUS</span></div></header>
      <main className="app-main">
        <div className="intro">
          <p className="eyebrow">YOUR INTELLIGENCE</p>
          <h1>Model connection.</h1>
          <p className="intro-copy">Detect available models from your API key, or connect another API or local server. Choose a model and verify its response before saving.</p>
        </div>
        <ProviderConnection />
      </main>
    </div>
  )
}
