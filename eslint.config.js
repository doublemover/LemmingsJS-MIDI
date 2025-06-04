export default [
  {
    files: ['**/*.js'],
    ignores: [
      'node_modules/**',
      'holiday93/**',
      'holiday94/**',
      'lemmings/**',
      'lemmings_ohNo/**',
      'xmas91/**',
      'xmas92/**',
      'img/**',
      'css/**'
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      indent: ['error', 2],
      quotes: ['error', 'single'],
      semi: ['error', 'always']
    }
  }
];
