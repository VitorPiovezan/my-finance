import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em build usado pelo GitHub Actions, setamos VITE_BASE_PATH=/my-finance/
// para o bundle ser servido corretamente em https://<user>.github.io/my-finance/.
// Em dev (vite dev) esse env fica vazio e o base cai pra '/'.
const base = process.env.VITE_BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
})
