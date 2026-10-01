import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev-прокси: /api уходит на сервер vibelog browser (порт по умолчанию
  // 3030), чтобы pnpm dev в web/ видел работающий API без CORS-проблем
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3030",
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
