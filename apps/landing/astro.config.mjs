import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://rzrizaldy.github.io',
  base: '/twin_md',
  outDir: './dist',
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
});
