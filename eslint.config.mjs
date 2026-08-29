import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      /**
       * The architecture's dependency rules, enforced rather than reviewed.
       *
       * `type:*` fixes the direction of dependency: the composition root may
       * reach the modules, the modules may reach shared platform code, and
       * nothing reaches back up.
       *
       * `scope:*` keeps Wallet and Withdrawal from importing each other's
       * internals. Their collaboration is a consumer-owned capability port
       * adapted at the composition root, and this is what makes that a rule
       * instead of a convention.
       */
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:app',
                'type:module',
                'type:platform',
              ],
            },
            {
              sourceTag: 'type:module',
              onlyDependOnLibsWithTags: ['type:platform'],
            },
            {
              sourceTag: 'type:platform',
              onlyDependOnLibsWithTags: ['type:platform'],
            },
            {
              sourceTag: 'scope:wallet',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:wallet'],
            },
            {
              sourceTag: 'scope:withdrawal',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:withdrawal'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
