project(
  'xattr-editor',
  license: ['MIT'],
)

project_id = 'com.github.kinten108101.XattrEditor'

gnome = import('gnome')

configure_file(
  input: 'init.py',
  output: meson.project_name(),
  configuration: {
  	'APPID': project_id
  },
  install_dir: get_option('bindir'),
  install_mode: 'rwxrwxrwx',
)

subdir('data')

gnome.post_install(
	update_desktop_database: true,
)
