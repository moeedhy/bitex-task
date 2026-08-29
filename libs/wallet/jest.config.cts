const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@bitex/wallet',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  // `uuid` v14 ships ESM only, and Jest runs these suites as CommonJS. Node's
  // resolver picks its `dist-node` ESM build, which Jest cannot parse unless the
  // package is handed to the transform like our own sources are. The pnpm store
  // layout puts it at `node_modules/.pnpm/uuid@<version>/node_modules/uuid`, so
  // both segments have to survive the negative lookahead.
  transformIgnorePatterns: ['node_modules/(?!(\\.pnpm/)?uuid)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
