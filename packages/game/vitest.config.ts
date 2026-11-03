import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'game', environment: 'node', include: ['src/**/*.test.ts'] },
});
