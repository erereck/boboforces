import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'texgen', environment: 'node', include: ['src/**/*.test.ts'] },
});
