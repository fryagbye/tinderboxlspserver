const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctxs = await Promise.all([
		// Client
		esbuild.context({
			entryPoints: ['client/src/extension.ts'],
			bundle: true,
			format: 'cjs',
			minify: production,
			sourcemap: !production,
			sourcesContent: false,
			platform: 'node',
			outfile: 'client/out/src/extension.js',
			external: ['vscode'],
			logLevel: 'silent',
			plugins: [
				esbuildProblemMatcherPlugin,
			],
		}),
		// Server
		esbuild.context({
			entryPoints: ['server/src/server.ts'],
			bundle: true,
			format: 'cjs',
			minify: production,
			sourcemap: !production,
			sourcesContent: false,
			platform: 'node',
			outfile: 'server/out/src/server.js',
			logLevel: 'silent',
			plugins: [
				esbuildProblemMatcherPlugin,
			],
		})
	]);

	if (watch) {
		await Promise.all(ctxs.map(ctx => ctx.watch()));
	} else {
		await Promise.all(ctxs.map(ctx => ctx.rebuild()));
		await Promise.all(ctxs.map(ctx => ctx.dispose()));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
