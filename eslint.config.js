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
  },
  {
    files: ['js/game/**/*.js', 'js/lemmings/**/*.js', 'js/midi/**/*.js', 'js/util/**/*.js'],
    rules: {
      'no-restricted-globals': ['error',
        {
          name: 'lemmings',
          message: 'Use explicit app context via dependencies instead of implicit global lemmings.'
        }
      ],
      'no-restricted-properties': ['error',
        {
          object: 'globalThis',
          property: 'lemmings',
          message: 'Use explicit app context via dependencies instead of globalThis.lemmings.'
        },
        {
          object: 'window',
          property: 'lemmings',
          message: 'Use explicit app context via dependencies instead of window.lemmings.'
        }
      ]
    }
  }
];
