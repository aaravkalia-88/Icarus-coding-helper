import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path'

function allowSceneAssets(server) {
  for (const assets of ['/vendor/three', '/landing-pages/secret-pathways-assets']) {
    server.middlewares.use(assets, (_request, response, next) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      next()
    })
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), { name: 'sandboxed-scene-assets', configureServer: allowSceneAssets, configurePreviewServer: allowSceneAssets }],
  resolve: {
    alias: [
      { find: '@designcodeio/threeui/style.css', replacement: resolve(import.meta.dirname, 'vendor/threeui/src/shaders/threeui.css') },
      { find: '@designcodeio/threeui', replacement: resolve(import.meta.dirname, 'src/threeui.ts') },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        popup: resolve(import.meta.dirname, 'popup.html'),
      },
    },
  },
})
