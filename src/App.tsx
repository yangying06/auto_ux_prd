import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { ForgePage } from './pages/ForgePage'
import { MapPage } from './pages/MapPage'

export default function App() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        <Route path="/" component={MapPage} />
        <Route path="/forge/:nodeId" component={ForgePage} />
        {/* Fallback: any unmatched hash route goes to MapPage */}
        <Route component={MapPage} />
      </Switch>
    </Router>
  )
}
