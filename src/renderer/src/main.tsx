import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProviderWithAuth } from 'convex/react'
import App from './App'
import { convexClient } from './lib/convex-client'
import { useConvexAuthAdapter } from './hooks/useConvexAuthAdapter'
import { AuthGate } from './features/auth/AuthGate'
import { AuthWatchdog } from './features/auth/AuthWatchdog'
import { PresenceHeartbeat } from './features/auth/PresenceHeartbeat'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProviderWithAuth client={convexClient} useAuth={useConvexAuthAdapter}>
      <AuthWatchdog />
      <AuthGate>
        <PresenceHeartbeat />
        <App />
      </AuthGate>
    </ConvexProviderWithAuth>
  </StrictMode>
)
