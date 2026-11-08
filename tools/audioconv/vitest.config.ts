import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'audioconv', environment: 'node', include: ['src/**/*.test.ts'] },
});
