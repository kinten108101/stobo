configure_file(
  input: 'app.desktop',
  output: 'xattr.desktop',
  configuration: {
  	'APPID': project_id,
  	'APPNAME': meson.project_name(),
  },
  install_dir: get_option('datadir') / 'applications',
)
