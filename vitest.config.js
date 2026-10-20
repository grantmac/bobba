import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'edge-runtime',include:['test/multiplayer.test.js'],server:{deps:{inline:['convex-test']}}}});
