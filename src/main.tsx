import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StoreProvider } from './data/store'
import './index.css'
import { FeedbackProvider } from './ui/Feedback'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </StoreProvider>
  </StrictMode>,
)
