configure_file(
	input: 'app.gschema.xml',
	output: app_id + '.gschema.xml',
	configuration: {
		'app_id': app_id,
		'resource_prefix': app_rdnn,
	},
	install_dir: get_option('datadir') / 'glib-2.0' / 'schemas',
)
