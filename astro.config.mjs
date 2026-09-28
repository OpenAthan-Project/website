import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './site',
  output: 'static',
  site: 'https://openathan.com',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  vite: { build: { sourcemap: false }, server: { strictPort: true } },
});
