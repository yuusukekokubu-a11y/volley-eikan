import { defineConfig } from 'vite';

// GitHub Pages（https://<ユーザー>.github.io/volley-eikan/）でも動くよう、相対パスで出力する
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    // 本編（index.html）と、動きの確認用の画面（inspect.html）
    rollupOptions: { input: { main: 'index.html', inspect: 'inspect.html' } },
  },
});
