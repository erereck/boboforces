import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'portcheck', environment: 'node', include: ['src/**/*.test.ts'] },
});
