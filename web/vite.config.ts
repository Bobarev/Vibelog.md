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
    // VL-180: web импортирует общий модуль src/core/phase-buttons.ts за
    // пределами web/ — dev-сервер должен отдавать файлы корня репозитория
    // (иначе vite dev блокирует их по fs.allow; сборка web/dist это не трогает)
    fs: {
      allow: [resolve(import.meta.dirname, "..")],
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
