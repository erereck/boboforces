import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'platform-api', environment: 'node', include: ['src/**/*.test.ts'] },
});
