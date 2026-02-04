import { defineConfig } from 'bunup'

export default defineConfig({
	entry: ['./src/index.ts', './src/cli.ts'],
	outDir: './dist',
	target: 'bun',
	format: 'esm',
	dts: true,
	clean: true,
	splitting: true,
})
