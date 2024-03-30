import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { get_object_from_formatting_string } from './builder-fmtstr.js';

const default_dialog = new Gtk.FileDialog();

/**
 * @note Main window is very small, a file dialog transient for main window will block
 * everything, so we must avoid that.
 */
const TRANSIENT = true;

/**
 * @template {string} V
 * @type {Map<V, Gio.File>}
 */
const output = new Map;

/**
 * 	@typedef {{
 *  	connect: {
 *			(sigName: `changed::${string}`, callback: ($obj: any, key: string, file: Gio.File) => void): number;
 *		};
 *		emit: {
 *			(sigName: `changed::${string}`, key: string, file: Gio.File): void;
 *		}
 * 	} & import("@girs/gjs").SignalMethods} OutputSignals
 */

const output_signals = /** @type {OutputSignals} */({});
imports.signals.addSignalMethods(output_signals);

/**
 * 	@param {Gtk.Widget} widget
 * 	@param {Gtk.Builder} builder
 * 	@param {Gtk.Window=} parent_window
 */
const useFile = (widget, builder, parent_window) => {
	const action_group = new Gio.SimpleActionGroup();

	const explore = new Gio.SimpleAction({
		name: 'explore',
		parameterType: GLib.VariantType.new_tuple([GLib.VariantType.new('s')]),
	});

	explore.connect('activate', (_action, parameter) => {
		if (!parameter) throw new Error;
		const values = parameter.recursiveUnpack();
		if (!Array.isArray(values))
			throw new Error;

		const launcher = Gtk.FileLauncher.new(Gio.File.new_for_uri(`file://${values[0]}`));
		(async () => {
			await launcher.open_containing_folder(TRANSIENT ? (parent_window || null) : null, null);
		})().catch(logError);
	});

	action_group.add_action(explore);

	const launch = new Gio.SimpleAction({
		name: 'launch',
		parameterType: GLib.VariantType.new_tuple([GLib.VariantType.new('s')]),
	});

	launch.connect('activate', (_action, parameter) => {
		if (!parameter) throw new Error;
		const values = parameter.recursiveUnpack();
		if (!Array.isArray(values))
			throw new Error;

		const launcher = Gtk.FileLauncher.new(Gio.File.new_for_uri(`file://${values[0]}`));
		(async () => {
			await launcher.launch(TRANSIENT ? (parent_window || null) : null, null);
		})().catch(logError);
	});

	action_group.add_action(launch);

	const save_file = new Gio.SimpleAction({
		name: 'save-file',
		parameterType: GLib.VariantType.new_tuple([GLib.VariantType.new('s'), GLib.VariantType.new('s')]),
	});

	save_file.connect('activate', (_action, parameter) => {
		if (!parameter) throw new Error;
		const values = parameter.recursiveUnpack();
		if (!Array.isArray(values))
			throw new Error;

		let dialog = /** @type {Gtk.FileDialog | null} */ (get_object_from_formatting_string(values[1], builder));
		if (!dialog) dialog = default_dialog;

        (/** @type {{ save: (window: Gtk.Window | null, cancellable: Gio.Cancellable | null) => Promise<Gio.File>; }} */ (/** @type {unknown} */ (dialog)))
        	.save(TRANSIENT ? (parent_window || null) : null, null)
        	.then(
        		file => {
					/** @type {V} */
        			const buffer_name = values[0];
        			output.set((buffer_name), file);
        			output_signals.emit(`changed::${buffer_name}`, buffer_name, file);
        		},
        		error => {
        			if (error instanceof GLib.Error && error.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED)) {}
        			else {
        				logError(error);
        			}
        		}
        	);
	});

	action_group.add_action(save_file);

	const pick_dir = new Gio.SimpleAction({
		name: 'select-folder',
		parameterType: GLib.VariantType.new_tuple([GLib.VariantType.new('s'), GLib.VariantType.new('s')]),
	});

	pick_dir.connect('activate', (_action, parameter) => {
		if (!parameter) throw new Error;
		const values = parameter.recursiveUnpack();
		if (!Array.isArray(values))
			throw new Error;

		let dialog = /** @type {Gtk.FileDialog | null} */ (get_object_from_formatting_string(values[1], builder));
		if (!dialog) dialog = default_dialog;

        (/** @type {{ select_folder: (window: Gtk.Window | null, cancellable: Gio.Cancellable | null) => Promise<Gio.File>; }} */ (/** @type {unknown} */ (dialog)))
        	.select_folder(TRANSIENT ? (parent_window || null) : null, null)
        	.then(
        		file => {
        			/** @type {V} */
        			const buffer_name = values[0];
        			output.set((buffer_name), file);
        			output_signals.emit(`changed::${buffer_name}`, buffer_name, file);
        		},
        		error => {
        			if (error instanceof GLib.Error && error.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED)) {}
        			else {
        				logError(error);
        			}
        		}
        	);
  	});

  	action_group.add_action(pick_dir);

  	const set_dir = new Gio.SimpleAction({
  		name: 'set',
  		parameterType: GLib.VariantType.new_tuple([GLib.VariantType.new('s'), GLib.VariantType.new('s')]),
  	});

  	set_dir.connect('activate', (_action, parameter) => {
  		if (!parameter) throw new Error;
		const values = parameter.recursiveUnpack();
		if (!Array.isArray(values))
			throw new Error;

		/** @type {V} */
		const buffer_name = values[0];
		/** @type {string} */
		const path = values[1];
		const file = Gio.File.new_for_path(path);
		output.set((buffer_name), file);
		output_signals.emit(`changed::${buffer_name}`, buffer_name, file);
  	});

  	action_group.add_action(set_dir);

	widget.insert_action_group('file', action_group);

	/**
	 * @param {string} action_name
	 * @param {string} key
	 */
	const disable_action = (action_name, key) => {
		for (const x of builder.get_objects()) {
			if ('action_name' in x && 'action_target' in x && x.action_name === action_name && /** @type {any[]} */((/** @type {GLib.Variant} */(x.action_target)).recursiveUnpack())[0] === key) {
				/** @type {Gtk.Widget} */(/** @type {unknown} */(x)).set_sensitive(false);
				return;
			}
		}
	}

	/**
	 * @param {string} action_name
	 * @param {string} key
	 */
	const enable_action = (action_name, key) => {
		for (const x of builder.get_objects()) {
			if ('action_name' in x && 'action_target' in x && x.action_name === action_name && /** @type {any[]} */((/** @type {GLib.Variant} */(x.action_target)).recursiveUnpack())[0] === key) {
				/** @type {Gtk.Widget} */(/** @type {unknown} */(x)).set_sensitive(true);
				return;
			}
		}
	}

	return { output, output_signals, enable_action, disable_action };
};

export default useFile;
