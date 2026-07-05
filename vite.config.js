import { defineConfig } from 'vite';

// GitHub Pages serves project sites from /REPO_NAME/ — not the domain root.
// Dev uses "/" so local `npm run dev` stays at http://localhost:5173/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/railgun-chickens/' : '/',
}));
