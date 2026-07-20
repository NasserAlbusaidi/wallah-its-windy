import { defineConfig } from 'vitest/config';

// Relative base so the build works when served from a GitHub Pages project
// subpath (https://user.github.io/cyclone-sim/) as well as from a domain root.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0, // keep woff2 as separate fingerprinted files, never inlined
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Data-integration tests parse the full baked rasters and can exceed
    // Vitest's 5 s default on shared GitHub runners.
    testTimeout: 20_000,
  },
});
