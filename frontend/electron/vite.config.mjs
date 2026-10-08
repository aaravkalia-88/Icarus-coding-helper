import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    ssr: true,
    outDir: resolve('dist-electron'),
    emptyOutDir: true,
    copyPublicDir: false,
    modulePreload: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve('electron/main.ts'),
        preload: resolve('electron/preload.ts'),
      },
      external: (id) => id === 'electron' || id.startsWith('node:'),
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
    },
  },
})
