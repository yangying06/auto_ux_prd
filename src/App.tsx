import { lazy, Suspense } from 'react'
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'

const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const ForgePage = lazy(() => import('./pages/ForgePage').then((module) => ({ default: module.ForgePage })))
const QaPage = lazy(() => import('./pages/QaPage').then((module) => ({ default: module.QaPage })))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-on-surface-variant">
      载入工作台...
    </div>
  )
}

function MapRoute() {
  return <MapPage />
}

function ForgeRoute() {
  return <ForgePage />
}

function QaRoute() {
  return <QaPage />
}

export default function App() {
  return (
    <Router hook={useHashLocation}>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={MapRoute} />
          <Route path="/forge/:nodeId" component={ForgeRoute} />
          <Route path="/qa" component={QaRoute} />
          {/* Fallback: any unmatched hash route goes to MapPage */}
          <Route component={MapRoute} />
        </Switch>
      </Suspense>
    </Router>
  )
}
