import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import { gettext as _ } from "gettext";

import extendBuilder from "./lib/builder.js";
import { syncCreate } from "./lib/functional.js";
import { addError } from "./services/status.js";
import Window from "./window.blp" with { type: "uri" };
import Preferences from "./preferences.blp" with { type: "uri" };
import HeaderBox, { bindStatusToHeaderboxSection } from "./legacy/headerbox.js";
import { defaultDecoder, listFileAsync, readJsonAsync, replaceJsonAsync } from "./lib/fileIO.js";
import TOML from "./lib/fast-toml.js";
import useFile from "./lib/file.js";
import ExtendedBuilder from "./lib/builder.js";
import { addSignalMethods } from "./lib/signals.js";

/**
 * @typedef {(signal: string, cb: (...args: any[]) => void) => number} ConnectMethod
 * @typedef {(id: number) => void} DisconnectMethod
 * @typedef {{ connect: ConnectMethod; disconnect: DisconnectMethod; }} Connectable
 * @typedef {{
 *  	disconnect(id: number): void;
 *      disconnectAll(): void;
 *      signalHandlerIsConnected(id: number): boolean;
 * }} SharedSignalMethods
 */

/**
 * @template {string} SignalName
 * @template {any[]} HandlerArgs
 *
 * @typedef {{
 * 		connect: {
 * 			(signal: SignalName, cb: ($obj: unknown, ...args: HandlerArgs) => void): number;
 * 		},
 *      emit: {
 *          (signal: SignalName, ...args: HandlerArgs): void;
 *      },
 * }} Signal
 */

const application = new Adw.Application({
	application_id: pkg.name,
	// Defaults to /com/github/kinten108101/Stobo/Devel
	// if pkg.name is com.github.kinten108101.Stobo.Devel
	resource_base_path: globalThis.resource_prefix,
});

const settings = /** @type {{ get_string(key: string): string } & Gio.Settings} */ (/** @type unknown */(new Gio.Settings({
	schema_id: pkg.name,
})));

/**
 * @param {Gio.File} gameDir
 */
const getDestinationDir = (gameDir) => {
	return gameDir.get_child("left4dead2").get_child("addons");
};

/**
 * @param {string} path
 */
const makeCanonicalPath = (path) => {
	const homeDir = GLib.get_home_dir();
	const newVal = GLib.canonicalize_filename(path.replace("~", homeDir), null);
	return newVal;
};

/**
 * @param {string} canonicalPath
 */
const collapsePath = (canonicalPath) => {
	const homeDir = GLib.get_home_dir();
	const newVal = canonicalPath.replace(homeDir, "~");
	return newVal;
};

/**
 * @param {Gio.Cancellable | null} cancellable
 */
const cleanup = async (cancellable) => {
	const preGameDir = settings.get_string("game-dir");
	const gameDir = Gio.File.new_for_path(makeCanonicalPath(preGameDir));
	const destDir = getDestinationDir(gameDir);
	const files = await listFileAsync(destDir);
	for (const x of files) {
		const name = x.get_basename();
		if (name === null) {
			console.warn("Path is invalid. Skipping...");
			continue;
		}
		if (!name.includes("@stvpk.vpk")) continue;
		await x.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
	}
};

/**
 * @param {Gio.File[]} archives
 * @param {Gio.Cancellable | null} cancellable
 */
const link = async (archives, cancellable) => {
	const preGameDir = settings.get_string("game-dir");
	const gameDir = Gio.File.new_for_path(makeCanonicalPath(preGameDir));
	const destDir = getDestinationDir(gameDir);
	for (const key in archives) {
		const x = archives[key];
		if (x === undefined) continue;
		const dest = destDir.get_child(`${key}@stvpk.vpk`);
		const symlinkValue = x.get_path();
		if (symlinkValue === null) {
			console.warn(`A source path is invalid. Skipping...`);
			continue;
		}
		try {
			await dest.make_symbolic_link_async(symlinkValue, GLib.PRIORITY_DEFAULT, cancellable);
		} catch (error) {
			logError(error);
			continue;
		}
	}
};

/**
 * @param {Gio.File} dir
 */
const loadFolder = async (dir) => {
	const files = await listFileAsync(dir);

	const manifests = files
		.filter(x => {
			const path = x.get_path();
			if (path === null) return false;
			return path.includes(".toml", path.length - 5);
		});

	const archives = files
		.filter(x => {
			const path = x.get_path();
			if (path === null) return false;
			return path.includes(".vpk", path.length - 4);
		});

	return (await Promise.all(archives.map(x => {
		return (async () => {
			const archivePath = x.get_path();
			if (archivePath === null) return null;
			const firstDotIdx = archivePath.indexOf(".");
			if (firstDotIdx === -1) return null;
			const baseName = archivePath.substring(0, firstDotIdx);

			const archiveData = {
				name: baseName,
				archive: x,
			};

			const manifestData = await (async () => {
				const manifest = manifests.find(y => {
					const manifestPath = y.get_path();
					console.log(manifestPath);
					if (manifestPath === null) return null;
					const firstDotIdx = archivePath.indexOf(".");
					if (firstDotIdx === -1) return null;
					const baseNameOfManifest = manifestPath.substring(0, firstDotIdx);
					return (baseName === baseNameOfManifest);
				});
				if (manifest === undefined) return null;
				const value = await (async () => {
					const [bytes] = await manifest.load_contents_async(null);
					const content = defaultDecoder.decode(bytes);
					const value = TOML.parse(content);
					if (!("steam_id" in value)) return null;
					if (typeof value.steam_id !== "number") return null;
					return /** @type {{ steam_id: number } & typeof value} */ (value);
				})();
				if (value) {
					return {
						manifest,
						steamId: value.steam_id,
					};
				} else return null;
			})();

			if (!manifestData) return {
				...archiveData
			};

			const a = {
				...archiveData,
				...manifestData,
			};

			return a;
		})();
	}))).filter(
		/**
		 * @template TValue
		 * @param {TValue | null} value
		 * @returns {value is TValue}
		 */
		(value) => value !== null);
};

/**
 * @param {{ root: Gio.File; entries: Awaited<ReturnType<typeof loadFolder>> }} workspace
 */
const exportAsList = async ({ root, entries }) => {
	const jsonContent = {
		repository: (() => {
			const val = root.get_path();
			if (val === null) throw new Error;
			return collapsePath(val);
		})(),
		addons: entries.map(x => {
			const basicFields = (() => {
				const archiveName = x.archive.get_basename();
				if (archiveName === null) throw new Error;
				return {
					archiveName,
				};
			})() || {};

			const steamFields = "steamId" in x ? { steamId: x.steamId } : {};

			return {
				...basicFields,
				...steamFields,
			};
		}),
		_version: 0,
	};

	const dialog = new Gtk.FileDialog({
		modal: true,
	});

	dialog.set_initial_name("addonlist.json");

	/**
	 * @type Gio.File
	 */
	let file;
	try {
		file = await (/** @type {{ save: (window: Gtk.Window | null, cancellable: Gio.Cancellable | null) => Promise<Gio.File>; }} */ (/** @type {unknown} */ (dialog)))
			.save(null, null);
	} catch (error) {
		logError(error);
		return;
	}

	await replaceJsonAsync(jsonContent, file);
};

/**
 * @type string[]
 */
let _recentWorkspaces = [];

settings.connect("changed::recent-workspaces", syncCreate(() => {
	const rawValue = settings.get_value("recent-workspaces").deepUnpack();
	if (!Array.isArray(rawValue)) return;
	const value = rawValue.filter(
		/**
		 * @returns {value is string}
		 */
		(value) => typeof value === "string");
	_recentWorkspaces = value;
}));

/**
 * @param {string} val
 */
const pushRecentWorkspace = (val) => {
	if (_recentWorkspaces.includes(val)) return false;
	settings.set_value("recent-workspaces", GLib.Variant.new_array(GLib.VariantType.new("s"), [GLib.Variant.new_string(val), ..._recentWorkspaces.map(x => GLib.Variant.new_string(x))]));
	return true;
};

const createWindow = () => {
	const builder = extendBuilder(Gtk.Builder.new_from_resource(Window.substr(11)));

	const window = builder.get_object("window", Gtk.ApplicationWindow);

	window.set_application(application);

	const folderStack = builder.get_object("folder_stack", Gtk.Stack);

	const files = useFile(window, builder, window);

	/**
	 * @type {Signal<"workspaceChanged", []> & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	/**
	 * @type {{ root: Gio.File; entries: Awaited<ReturnType<typeof loadFolder>> }=}
	 */
	let _workspace;

	/**
	 * @param {typeof _workspace} val
	 */
	const setWorkspace = (val) => {
		_workspace = val;
		events.emit("workspaceChanged");
	};

	/**
	 * Has side effects
	 *
	 * @param {Gio.File} dir
	 */
	const updateWorkspace = (dir) => {
		folderStack.set_visible_child_name("has-folder");
		(async () => {
			const entries = await loadFolder(dir);
			console.log(entries);
			setWorkspace({
				root: dir,
				entries,
			});
			const dirPath = dir.get_path();
			if (dirPath === null) throw new Error;
			pushRecentWorkspace(collapsePath(dirPath));
		})().catch(logError);
	};

	files.output_signals.connect("changed::workspace", (_, __, dir) => {
		updateWorkspace(dir);
	});

	const headerbox = HeaderBox(builder);

	events.connect("workspaceChanged", syncCreate(() => {
		// TODO(kinten): Empty workspace data? When? How is UI?
		if (_workspace === undefined) return;
		const { addonCountLabel, headerboxProfileLabel } = headerbox;
		(() => {
			const { entries } = _workspace;
			addonCountLabel.set_label(String(entries.length));
			addonCountLabel.set_tooltip_text(_("Number of Add-ons") + ` (${entries.length})`);
		})();
		headerboxProfileLabel.set_label((() => {
			const { root } = _workspace;
			const profileName = root.get_basename();
			if (profileName === null) return _("Unknown repository");
			return profileName;
		})());
	}));

	const profileBar = (() => {
		const profileBar = builder.get_object("profile_bar", Adw.Clamp);
		const primaryButton = builder.get_object("primary_button", Gtk.ToggleButton);
		const profileLabel = builder.get_object("profile_label", Gtk.Label);

		primaryButton.connect("notify::active", syncCreate(() => {
			if (primaryButton.active) {
				profileBar.add_css_class("active");
			} else {
				profileBar.remove_css_class("active");
			}
		}));

		return {
			primaryButton,
			profileLabel
		};
	})();

	const revealHeaderbox = () => {
		headerbox.revealChild();
		profileBar.primaryButton.set_active(true);
	};

	const unrevealHeaderbox = () => {
		headerbox.unrevealChild();
		profileBar.primaryButton.set_active(false);
	};

	bindStatusToHeaderboxSection(headerbox, profileBar, window);

	(() => {
		const actions = new Gio.SimpleActionGroup();

		const add = new Gio.SimpleAction({
			name: "add",
		});

		add.connect("activate", () => {
			folderStack.set_visible_child_name("pre-folder");
		});

		actions.add_action(add);

		const restore = new Gio.SimpleAction({
			name: "restore",
		});

		restore.connect("activate", () => {
			const path = _recentWorkspaces[0];
			if (path === undefined) throw new Error;
			const file = Gio.File.new_for_path(makeCanonicalPath(path));
			updateWorkspace(file);
		});

		actions.add_action(restore);

		const exportList = new Gio.SimpleAction({
			name: "export",
		});

		exportList.connect("activate", () => {
			if (_workspace === undefined) {
				console.debug("Could not export when there is no workspace");
				return;
			}
			exportAsList(_workspace).catch(logError);
		});

		actions.add_action(exportList);

		const switchTo = new Gio.SimpleAction({
			name: "switchTo",
			parameterType: GLib.VariantType.new("s"),
			state: GLib.Variant.new_string(""),
		});

		switchTo.connect("activate", (_action, parameter) => {
			if (parameter === null) throw new Error;
			const [path] = parameter.get_string();
			if (path === null) throw new Error;
			const file = Gio.File.new_for_path(path);
			updateWorkspace(file, false);
		});

		events.connect("workspaceChanged", () => {
			switchTo.change_state(GLib.Variant.new_string(_workspace?.root?.get_basename() || ""));
		});

		switchTo.connect("change-state", (action, value) => {
			if (value === null) throw new Error;
			action.set_state(value);
		});

		actions.add_action(switchTo);

		window.insert_action_group("workspace", actions);

		application.set_accels_for_action("workspace.add", ["<Primary>O"]);
	})();

	(() => {
		const actions = new Gio.SimpleActionGroup();

		let nextReveal = false;

		const headerbox_reveal = new Gio.SimpleAction({
			name: "reveal",
		});

		headerbox_reveal.connect("activate", (_action) => {
			nextReveal = !nextReveal;
			if (nextReveal) {
				revealHeaderbox();
			} else {
				unrevealHeaderbox();
			}
		});

		actions.add_action(headerbox_reveal);

		const headerbox_box_switch = new Gio.SimpleAction({
			name: "box-switch",
			parameter_type: GLib.VariantType.new("s"),
		});

		headerbox_box_switch.connect("activate", (_action, parameter) => {
			if (!parameter) throw new Error;
			const boxName = parameter.deepUnpack();
			if (typeof boxName !== "string") throw new Error;
			headerbox.setCurrentPage(boxName);
		});

		actions.add_action(headerbox_box_switch);

		// Initialize default page
	    headerbox_box_switch.activate(GLib.Variant.new_string("status_box"));

		window.insert_action_group("headerbox", actions);
	})();

	(() => {
		const actions = new Gio.SimpleActionGroup();

		const inject = new Gio.SimpleAction({
			name: "inject",
		});

		inject.connect("activate", () => {
			if (_workspace === undefined) {
				console.debug("Could not inject when there is no workspace");
				return;
			}

			const cancellable = new Gio.Cancellable;

			(async () => {
				await cleanup(cancellable);
				const { entries } = _workspace;
				await link(entries.map(x => x.archive), cancellable);
			})().catch(logError);
		});

		actions.add_action(inject);

		window.insert_action_group("inject", actions);
	})();

	addError({
		short: _("Disconnected"),
		msg: _("Could not connect to daemon. Make sure that you\'ve installed Add-on Box."),
	});

	return window;
};

(() => {
	/**
	 * @type {Gtk.ApplicationWindow=}
	 */
	let window = undefined;

	application.connect("activate", () => {
		if (window === undefined) window = createWindow();
		window.present();
	});
})();

const createPreferences = () => {
	const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(Preferences.substr(11)));

	const window = builder.get_object("window", Adw.PreferencesWindow);

	const gameDirPath = builder.get_object("game-dir-path", Gtk.Label);

	const file = useFile(window, builder, window);

	file.output_signals.connect("changed::game-directory", (_, __, dir) => {
		const path = dir.get_path();
		if (path === null) throw new Error;
		settings.set_string("game-dir", collapsePath(path));
	});

	settings.connect("changed::game-dir", syncCreate(() => {
		 const path = settings.get_string("game-dir");
		 gameDirPath.set_label(path || _("Select"));
	}));

	const actions = new Gio.SimpleActionGroup();

	actions.add_action(settings.create_action("game-dir"));

	window.insert_action_group("preferences", actions);

	return window;
};

(() => {
	/**
	 * @type {Adw.PreferencesWindow=}
	 */
	let window = undefined;

	const showPreferences = new Gio.SimpleAction({
		name: "show-preferences",
	});

	showPreferences.connect("activate", () => {
		if (window === undefined) window = createPreferences();
		window.present();
	});

	application.add_action(showPreferences);
})();

export {
	settings,
};

export default application;
