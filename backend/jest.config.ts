import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  collectCoverageFrom: [
    'modules/**/*.service.ts',
    'auth/auth.service.ts',
    '!**/*.spec.ts',
    '!**/*.d.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'json-summary'],
  testEnvironment: 'node',
  coverageThreshold: {
    global: { statements: 70, branches: 55, functions: 75, lines: 70 },
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  reporters: process.env.CI
    ? [
        'default',
        ['jest-junit', { outputDirectory: './reports', outputName: 'junit.xml' }],
      ]
    : ['default'],
};

export default config;
