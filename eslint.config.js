// Flat ESLint config (ESLint 9+). Run: `npx eslint .` of `npm run lint`.
// Content scripts zijn classic scripts (geen modules), draaien in de browser
// met chrome.* APIs in scope.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            '.git/**',
            '.cursor/**',
            'lib/**',
        ],
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                jspdf: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'no-undef': 'error',
            'no-redeclare': 'error',
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-prototype-builtins': 'off',
        },
    },
];
