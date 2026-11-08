import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'skingen', environment: 'node', include: ['src/**/*.test.ts'] },
});
