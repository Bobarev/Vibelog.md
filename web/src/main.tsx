import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { PreferencesProvider } from "@/components/preferences.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <PreferencesProvider>
        <App />
      </PreferencesProvider>
    </ThemeProvider>
  </StrictMode>
)
