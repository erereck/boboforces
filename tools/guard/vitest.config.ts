import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'guard', environment: 'node', include: ['src/**/*.test.ts'] },
});
