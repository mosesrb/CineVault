const js = require('@eslint/js');
const globals = require('globals');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
    {
        ignores: [
            '**/node_modules/**',
            'frontend/dist/**',
            'frontend/android/**',
            'runtime/**',
            'backups/**',
            'hls-cache/**'
        ]
    },
    {
        ...js.configs.recommended,
        files: [
            'app.js',
            'index.js',
            'middleware/**/*.js',
            'models/**/*.js',
            'routes/**/*.js',
            'services/**/*.js',
            'startup/**/*.js',
            'scripts/**/*.js',
            'tests/**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.jest }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-useless-escape': 'warn'
        }
    },
    {
        files: ['frontend/src/**/*.{js,jsx}', 'frontend/vite.config.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser, ...globals.node, ...globals.vitest }
        },
        plugins: { react, 'react-hooks': reactHooks },
        settings: { react: { version: '18.3' } },
        rules: {
            ...js.configs.recommended.rules,
            ...react.configs.recommended.rules,
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-useless-escape': 'warn',
            'react/prop-types': 'off',
            'react/react-in-jsx-scope': 'off',
            'react/no-unescaped-entities': 'off'
        }
    }
];
