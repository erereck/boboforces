import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'render', environment: 'node', include: ['src/**/*.test.ts'] },
});
