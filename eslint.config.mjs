import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['out/**', 'media/dist/**', 'node_modules/**'],
	},
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],
			'curly': 'warn',
			'eqeqeq': 'warn',
			'no-throw-literal': 'warn',
			'semi': ['warn', 'always'],
		},
	},
);
