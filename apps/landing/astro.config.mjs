import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://twin-md.dev',
  trailingSlash: 'never',
  vite: {
    plugins: [tailwindcss()],
  },
});
