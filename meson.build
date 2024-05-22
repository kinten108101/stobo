project(
	'stobo',
  	license: 'MIT'
)

# meson libraries
gnome = import('gnome')
i18n = import('i18n')

# names, misc
app_id = 'com.github.kinten108101.Stobo'
app_rdnn = '/com/github/kinten108101/Stobo'

# paths
bindir = join_paths(get_option('prefix'), 'bin')
libdir = join_paths(get_option('prefix'), get_option('libdir'))
datadir = join_paths(get_option('prefix'), get_option('datadir'))
pkgdatadir = join_paths(datadir, app_id)

# programs
gjs = dependency('gjs-1.0', version: '>=1.76.0', required: true).get_variable(pkgconfig: 'gjs_console')
gjspack = find_program('./troll/gjspack/bin/gjspack', required: true)
blueprint_compiler = find_program('blueprint-compiler', version: '>=0.8.1', required: true)

subdir('data')
subdir('src')
subdir('po')

gnome.post_install(
  glib_compile_schemas: true,
  # gtk_update_icon_cache: true,
  update_desktop_database: true
)
