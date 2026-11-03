import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'world', environment: 'node', include: ['src/**/*.test.ts'] },
});
