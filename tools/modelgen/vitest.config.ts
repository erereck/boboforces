import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'modelgen', environment: 'node', include: ['src/**/*.test.ts'] },
});
