import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'switch', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
