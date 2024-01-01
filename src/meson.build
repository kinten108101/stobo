configure_file(
	input: 'bin.js',
	output: app_id,
	configuration: {
		'gjs': gjs,
		'app_id': app_id,
		'resource_prefix': app_rdnn,
		'version': meson.project_version(),
		'prefix': get_option('prefix'),
		'libdir': libdir,
		'datadir': datadir,
	},
	install: true,
	install_dir: get_option('bindir'), # no prefix
	install_mode: 'rwxrwxrwx',
)

custom_target('gjspack',
	input: ['main.js', '../po/POTFILES'],
	output: app_id + '.src.gresource',
	command: [
		gjspack,
		'--appid', app_id,
		'--prefix', app_rdnn,
		'--project-root', meson.project_source_root(),
		'--resource-root', join_paths(meson.project_source_root(), 'src'),
		'--blueprint-compiler', blueprint_compiler,
		'--no-executable',
		'@INPUT0@',
		'@OUTDIR@',
	],
	install: true,
	install_dir: pkgdatadir,
	build_always_stale: true,
)
