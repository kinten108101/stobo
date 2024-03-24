// Enforce specific library version
import "gi://Gdk?version=4.0";
import "gi://Gtk?version=4.0";
import "gi://Soup?version=3.0";

import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import Soup from "gi://Soup";

// Use promisify helper API
Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async', 'read_text_finish');
Gio._promisify(Adw.MessageDialog.prototype, 'choose', 'choose_finish');
Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
Gio._promisify(Gtk.FileDialog.prototype, 'select_folder', 'select_folder_finish');
// FIXME(kinten): Why is this not working
Gio._promisify(Gtk.FileLauncher.prototype, 'open_containing_folder', 'open_containing_folder_finish');

/* Gio.Subprocess */
Gio._promisify(Gio.Subprocess.prototype, 'communicate_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async');

Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'append_to_async', 'append_to_finish');
Gio._promisify(Gio.File.prototype, 'copy_async', 'copy_finish');
Gio._promisify(Gio.File.prototype, 'create_async', 'create_finish');
Gio._promisify(Gio.File.prototype, 'create_readwrite_async', 'create_readwrite_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'find_enclosing_mount_async', 'find_enclosing_mount_finish');
Gio._promisify(Gio.File.prototype, 'load_bytes_async', 'load_bytes_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'make_symbolic_link_async', 'make_symbolic_link_finish');
Gio._promisify(Gio.File.prototype, 'move_async', 'move_finish');
Gio._promisify(Gio.File.prototype, 'open_readwrite_async', 'open_readwrite_finish');
Gio._promisify(Gio.File.prototype, 'query_default_handler_async', 'query_default_handler_finish');
Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async', 'query_filesystem_info_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.File.prototype, 'replace_async', 'replace_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_readwrite_async', 'replace_readwrite_finish');
Gio._promisify(Gio.File.prototype, 'set_attributes_async', 'set_attributes_finish');
Gio._promisify(Gio.File.prototype, 'set_display_name_async', 'set_display_name_finish');
Gio._promisify(Gio.File.prototype, 'trash_async', 'trash_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');
Gio._promisify(Gio.FileOutputStream.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_all_async', 'read_all_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'skip_async', 'skip_finish');
Gio._promisify(Gio.OutputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Gio.OutputStream.prototype, 'flush_async', 'flush_finish');
Gio._promisify(Gio.OutputStream.prototype, 'splice_async', 'splice_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async', 'write_all_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_async', 'write_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'writev_all_async', 'writev_all_finish');
Gio._promisify(Gio.OutputStream.prototype, 'writev_async', 'writev_finish');
Gio._promisify(Soup.Session.prototype, 'preconnect_async', 'preconnect_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Soup.Session.prototype, 'send_and_splice_async', 'send_and_splice_finish');
Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(Soup.Session.prototype, 'websocket_connect_async', 'websocket_connect_finish');

// register custom widgets
import "./lib/iconWithBadge.js";
import "./lib/themeselector.js";

// register icons
import "./icons/addon-box.svg" with { type: "icon" };
import "./icons/pip-in-symbolic.svg" with { type: "icon" };
import "./icons/pip-out-symbolic.svg" with { type: "icon" };

import application from "./application.js";

pkg.initGettext();

import "./style.css";
import "./style-dark.css";

/**
 * @param {string[] | null} argv
 */
export function main(argv) {
	return application.runAsync(argv || undefined);
}
