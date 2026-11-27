import { defineConfig, type Project } from '@playwright/test'

const projects: Project[] = [
  {
    name: 'packaged-dir',
    testMatch: /.*\.spec\.ts$/,
    testIgnore: ['**/packaged.spec.ts', '**/local/**'],
  },
  {
    name: 'installed',
    testMatch: /packaged\.spec\.ts$/,
  },
]

if (process.env.STECKNADEL_LOCAL === '1') {
  projects.push({ name: 'local', testMatch: /local\/.*\.spec\.ts$/ })
}

export default defineConfig({
  testDir: 'e2e',
  testIgnore: process.env.STECKNADEL_LOCAL === '1' ? [] : ['**/local/**'],
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  outputDir: 'test-results',
  projects,
})
