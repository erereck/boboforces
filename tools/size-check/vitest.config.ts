import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'size-check', environment: 'node', include: ['src/**/*.test.ts'] },
});
