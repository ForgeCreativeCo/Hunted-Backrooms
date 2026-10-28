import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // The game server (npm run dev starts both) handles the lobby and multiplayer nights.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
