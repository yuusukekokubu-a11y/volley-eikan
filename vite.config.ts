import { defineConfig } from 'vite';

// GitHub Pages（https://<ユーザー>.github.io/volley-eikan/）でも動くよう、相対パスで出力する
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
