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
import Matcher from "./matcher.blp" with { type: "uri" };
import HeaderBox, { bindStatusToHeaderboxSection } from "./legacy/headerbox.js";
import { defaultDecoder, isDirAsync, listFileAsync, makeDirNonstrictAsync, readJsonAsync, replaceJsonAsync } from "./lib/fileIO.js";
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
	applicationId: pkg.name,
	// Defaults to /com/github/kinten108101/Stobo/Devel
	// if pkg.name is com.github.kinten108101.Stobo.Devel
	resourceBasePath: globalThis.resource_prefix,
});

const settings = /** @type {{ get_string(key: string): string } & Gio.Settings} */ (/** @type unknown */(new Gio.Settings({
	schemaId: pkg.name,
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
 * @param {Gio.File} root
 * @param {Gio.File[]} archives
 * @param {Gio.Cancellable | null} cancellable
 */
const link = async (root, archives, cancellable) => {
	const preGameDir = settings.get_string("game-dir");
	const gameDir = Gio.File.new_for_path(makeCanonicalPath(preGameDir));
	const destDir = getDestinationDir(gameDir);
	for (const index in archives) {
		const x = archives[index];
		if (x === undefined) continue;
		if (await isDirAsync(x)) {
			const subarchives = await listFileAsync(x);
			for (const subindex in subarchives) {
				const y = subarchives[subindex];
				if (y === undefined) continue;
				const dest = destDir.get_child(`${index}-${subindex}@stvpk.vpk`);
				const symlinkValue = y.get_path();
				if (symlinkValue === null) {
					console.warn("source-path-missing");
					continue;
				}
				try {
					await dest.make_symbolic_link_async(symlinkValue, GLib.PRIORITY_DEFAULT, cancellable);
				} catch (error) {
					logError(error);
					continue;
				}
			}
		} else {
			const dest = destDir.get_child(`${index}@stvpk.vpk`);
			const symlinkValue = x.get_path();
			if (symlinkValue === null) {
				console.warn("source-path-missing");
				continue;
			}
			try {
				await dest.make_symbolic_link_async(symlinkValue, GLib.PRIORITY_DEFAULT, cancellable);
			} catch (error) {
				logError(error);
				continue;
			}
		}
	}
	const rootPath = root.get_path();
	if (rootPath === null) throw new Error;
	const logFile = destDir.get_child(".stobo-log");
	/**
	 * @type object
	 */
	let logContent;
	try {
		logContent = await readJsonAsync(logFile);
	} catch (error) {
		logContent = {};
	}
	const entries = "entries" in logContent && Array.isArray(logContent.entries) ? logContent.entries : [];
	await replaceJsonAsync({
		entries: [{
			root: collapsePath(rootPath)
		}, ...entries],
	}, logFile);
};

/**
 * @param {(Awaited<ReturnType<typeof loadFolder>>)} entries
 */
const filter = (entries) => {
	/**
	 * @type Gio.File[]
	 */
	const files = [];
	/**
	 * @type Map<string, Gio.File[]>
	 */
	const shuffleGroups = new Map;
	for (const key in entries) {
		const x = entries[key];
		if (x === undefined) continue;
		if ("enabled" in x && x.enabled === false) continue;
		const { archive } = x;
		if ("shuffleGroup" in x && x.shuffleGroup !== null) {
			const { shuffleGroup } = x;
			let y = shuffleGroups.get(shuffleGroup);
			if (y === undefined) {
				y = [];
				shuffleGroups.set(shuffleGroup, y);
			}
			y.push(archive);
		} else {
			files.push(archive);
		}
	}
	for (const x of shuffleGroups) {
		const shuffleFiles = x[1];
		const selectIdx = Math.round(Math.random() * (shuffleFiles.length - 1));
		const selected = shuffleFiles[selectIdx];
		if (selected === undefined) continue;
		files.push(selected);
	}
	return files;
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
			const lastSlash = archivePath.lastIndexOf("/");
			const baseName = archivePath.substring(lastSlash + 1, firstDotIdx);

			const archiveData = {
				name: baseName,
				archive: x,
			};

			const manifestData = await (async () => {
				const manifest = manifests.find(y => {
					const manifestPath = y.get_path();
					if (manifestPath === null) return null;
					const firstDotIdx = archivePath.indexOf(".");
					if (firstDotIdx === -1) return null;
					const lastSlash = archivePath.lastIndexOf("/");
					const baseNameOfManifest = manifestPath.substring(lastSlash + 1, firstDotIdx);
					return (baseName === baseNameOfManifest);
				});
				if (manifest === undefined) return null;
				const value = await (async () => {
					const [bytes] = await manifest.load_contents_async(null);
					const content = defaultDecoder.decode(bytes);
					const value = TOML.parse(content);
					const enabled = (() => {
						if (!("enabled" in value)) return null;
						if (typeof value["enabled"] !== "boolean") return null;
						return value["enabled"];
					})();
					const steamId = (() => {
						if (!("steam_id" in value)) return null;
						if (typeof value["steam_id"] !== "number") return null;
						return value["steam_id"];
					})();
					const note = (() => {
						if (!("note" in value)) return null;
						if (typeof value["note"] !== "string") return null;
						return value["note"];
					})();
					const shuffleGroup = (() => {
						if (!("shuffle_group" in value)) return null;
						if (typeof value["shuffle_group"] !== "string") return null;
						return value["shuffle_group"];
					})();

					return {
						enabled,
						steamId,
						note,
						shuffleGroup,
					};
				})();
				if (value) {
					return {
						manifest,
						...value
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

			const noteField = "note" in x ? { note: x.note } : {};

			return {
				...basicFields,
				...steamFields,
				...noteField,
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
	const existingPathIdx = _recentWorkspaces.indexOf(val);
	const newVal = (() => {
		if (existingPathIdx !== -1) {
			return [val, ...([ ..._recentWorkspaces ].splice(existingPathIdx, 1))];
		} else {
			return [val, ..._recentWorkspaces];
		}
	})();
	settings.set_value("recent-workspaces", GLib.Variant.new_array(GLib.VariantType.new("s"), newVal.map(x => GLib.Variant.new_string(x))));
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
	 * @type {Readonly<{ root: Gio.File; entries: Awaited<ReturnType<typeof loadFolder>> }>=}
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

	const matcherList = builder.get_object("matcher_list", Gtk.ListBox);

	events.connect("workspaceChanged", () => {
		if (_workspace === undefined) {
			console.debug("Cannot update matcher list when there is no workspace");
			return;
		}

		const { entries } = _workspace;

		matcherList.remove_all();

		entries.forEach(x => {
			if ("steamId" in x) return;

			const button = new Gtk.Button({
				actionName: "win.show-matcher",
			});

			const row = new Adw.ActionRow({
				title: x.name,
				activatableWidget: button,
			});

			row.add_suffix(button);

			matcherList.append(row);
		});
	});

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
			parameterType: GLib.VariantType.new("s"),
		});

		headerbox_box_switch.connect("activate", syncCreate((_action, parameter) => {
			if (!parameter) throw new Error;
			const boxName = parameter.deepUnpack();
			if (typeof boxName !== "string") throw new Error;
			headerbox.setCurrentPage(boxName);
		}, null, GLib.Variant.new_string("status_box")));

		actions.add_action(headerbox_box_switch);

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
				const { root, entries } = _workspace;
				const archives = filter(entries);
				await link(root, archives, cancellable);
			})().catch(logError);
		});

		actions.add_action(inject);

		window.insert_action_group("inject", actions);
	})();

	/**
	 * @type {ReturnType<typeof createMatcherWindow>?}
	 */
	let matcherWindow = null;

	const showMatcher = new Gio.SimpleAction({
		name: "show-matcher",
		parameterType: GLib.VariantType.new("s")
	});

	showMatcher.connect("activate", (_, parameter) => {
		if (parameter === null) throw new Error;

		const [parameterJs] = parameter.get_string();

		if (matcherWindow === null) {
			const newWindow = createMatcherWindow.apply(window);

			newWindow.connect("close-request", () => {
				matcherWindow = null;
				return false;
			});

			matcherWindow = newWindow;
		}

		matcherWindow.updateTarget(parameterJs);

		matcherWindow.present();
	});

	window.add_action(showMatcher);

	addError({
		short: _("Disconnected"),
		msg: _("Could not connect to daemon. Make sure that you\'ve installed Add-on Box."),
	});

	return window;
};

(() => {
	/**
	 * @type {Gtk.ApplicationWindow?}
	 */
	let window = null;

	application.connect("activate", () => {
		if (window === null) {
			const newWindow = createWindow();

			newWindow.connect("close-request", () => {
				window = null;
				return false;
			});

			window = newWindow;
		}
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

/**
 * @this Gtk.Window
 */
function createMatcherWindow() {
	const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(Matcher.substr(11)));

	/**
	 * @type {{} & Signal<"targetChanged", []> & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	const window = builder.get_object("window", Gtk.Window);

	window.set_transient_for(this);

	/**
	 * @param {string} val
	 */
	const updateTarget = (val) => {

	};

	const actions = new Gio.SimpleActionGroup;

	window.insert_action_group("matcher", actions);

	return Object.assign(window, {
		updateTarget,
	});
};

(() => {
	/**
	 * @type {Adw.PreferencesWindow?}
	 */
	let window = null;

	const showPreferences = new Gio.SimpleAction({
		name: "show-preferences",
	});

	showPreferences.connect("activate", () => {
		if (window === null) {
			const newWindow = createPreferences();

			newWindow.connect("close-request", () => {
				window = null;
				return false;
			});

			window = newWindow;
		}
		window.present();
	});

	application.add_action(showPreferences);
})();

export {
	settings,
};

export default application;
