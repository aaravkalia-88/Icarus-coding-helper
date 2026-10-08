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
          <p className="intro-copy">Choose a cloud API or local model server. Test the connection and keep your token ready for future sessions.</p>
        </div>
        <ProviderConnection />
      </main>
    </div>
  )
}
