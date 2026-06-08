import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { ForgePage } from './pages/ForgePage'
import { MapPage } from './pages/MapPage'
import { QaPage } from './pages/QaPage'

export default function App() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={MapPage} />
        <Route path="/forge/:nodeId" component={ForgePage} />
        <Route path="/qa" component={QaPage} />
        {/* Fallback: any unmatched hash route goes to MapPage */}
        <Route component={MapPage} />
      </Switch>
    </Router>
  )
}
