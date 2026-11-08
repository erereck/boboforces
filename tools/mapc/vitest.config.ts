import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'mapc', environment: 'node', include: ['src/**/*.test.ts'] },
});
