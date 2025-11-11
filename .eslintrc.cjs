module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.base.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'unused-imports', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:prettier/recommended',
  ],
  rules: {
    'no-console': 'warn',
    'import/no-default-export': 'error',
    '@typescript-eslint/consistent-type-imports': 'error',
    'unused-imports/no-unused-imports': 'error',
  },
  ignorePatterns: ['dist', 'node_modules'],
};
