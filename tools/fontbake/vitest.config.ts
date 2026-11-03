import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'fontbake', environment: 'node', include: ['src/**/*.test.ts'] },
});
