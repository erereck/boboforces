import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'nav', environment: 'node', include: ['src/**/*.test.ts'] },
});
