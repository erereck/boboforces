import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'input', environment: 'node', include: ['src/**/*.test.ts'] },
});
