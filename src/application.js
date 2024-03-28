import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import { gettext as _ } from "gettext";

import extendBuilder from "./lib/builder.js";
import { syncCreate } from "./lib/functional.js";
import { addError } from "./services/status.js";
import Window from "./window.blp" with { type: "uri" };
import AddonDetails from "./addonDetails.blp" with { type: "uri" };
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

var Stobo = {
	Object: {
		/**
		 * @template {object} SrcType
		 * @template {object} PropsType
		 * @param {SrcType} src
		 * @param {(target: SrcType) => PropsType} props
		 * @returns {SrcType & PropsType}
		 * @experimental
		 */
		assign: (src, props) => {
			return Object.assign(src, props(src));
		},
	}
};

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
			const subarchives = (await listFileAsync(x)).filter(x => {
				const path = x.get_path();
				if (path === null) return false;
				return path.includes(".vpk", path.length - 4);
			});
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
 * @param {Readonly<Map<string, string>>} previousShuffleChoices
 */
const filter = (entries, previousShuffleChoices) => {
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
	/**
	 * @type Map<string, string>
	 */
	const shuffleChoices = new Map;
	for (const x of shuffleGroups) {
		const [groupName, preShuffleFiles] = x;
		const shuffleFiles = (() => {
			const previousChoice = previousShuffleChoices.get(groupName);
			if (previousChoice === undefined) return preShuffleFiles;
			const foundIdx = preShuffleFiles.map(x => x.get_basename()).indexOf(previousChoice);
			if (foundIdx !== -1) {
				preShuffleFiles.splice(foundIdx, 1);
			}
			return preShuffleFiles;
		})();
		const selectIdx = Math.round(Math.random() * (shuffleFiles.length - 1));
		const selected = shuffleFiles[selectIdx];
		if (selected === undefined) continue;
		const name = selected.get_basename();
		if (name === null) continue;
		shuffleChoices.set(groupName, name);
		files.push(selected);
	}
	return { files, shuffleChoices: /** @type {Readonly<typeof shuffleChoices>} */(shuffleChoices) };
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

/**
 * @param {Gio.File} root
 * @param {"manual-order" | "shuffle-choices"} filename
 */
const loadFromWorkspaceStorage = async (root, filename) => {
	const workspaceData = root.get_child(".stobo");
	await makeDirNonstrictAsync(workspaceData);
	const manualOrderFile = workspaceData.get_child(filename);
	let content = await readJsonAsync(manualOrderFile);

	switch (filename) {
	case "manual-order":
		{
			if (!Array.isArray(content)) {
				throw new Error;
			}

			for (const index in content) {
				const x = content[index];
				if (typeof x !== "string") throw new Error;;
			}
		}
		break;
	case "shuffle-choices":
		{
			if (typeof content !== "object" || content === null) {
				throw new Error;
			}

			const newVal = new Map;

			for (const key in content) {
				const x = content[key];
				if (typeof x !== "string") throw new Error;
				newVal.set(key, x);
			}

			content = newVal;
		}
		break;
	default:
		throw new Error;
	}

	return content;
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
	 * @type {Readonly<{
	 * 	root: Gio.File;
	 * 	entries: Awaited<ReturnType<typeof loadFolder>>;
	 *  requestChangeManualOrder(params: {
 	 * 		type: "move";
 	 * 		src: string;
 	 *  	target: string;
	 * 	}): void;
	 *  get manualOrder(): Readonly<string[]>;
	 *  disconnect(id: number): void;
	 *  connect(signal: string, cb: (...args: any[]) => void): number;
	 *  requestSaveShuffleChoices(choices: ReturnType<typeof filter>["shuffleChoices"]): void;
	 * 	get shuffleChoices(): Readonly<Map<string, string>>;
	 * 	onFsChanged(cb: () => void): void;
	 * 	destroy(): void;
	 * }>=}
	 */
	let _workspace;

	/**
	 * @param {Exclude<typeof _workspace, undefined>} val
	 */
	const setWorkspace = (val) => {
		_workspace?.destroy();
		_workspace = val;
		events.emit("workspaceChanged");
	};

	/**
	 * Has side effects
	 *
	 * @param {Gio.File} root
	 */
	const updateWorkspace = (root) => {
		folderStack.set_visible_child_name("has-folder");
		(async () => {
			const entries = await loadFolder(root);

			const monitor = root.monitor_directory(Gio.FileMonitorFlags.NONE, null);

			/**
			 * @type {number[]}
			 */
			const monitorBindings = [];

			/**
			 * @type {{}
			 * 	& Signal<"changed::manual-order", [typeof _manualOrder]>
			 * 	& Signal<"changed::shuffle-choices", [typeof _shuffleChoices]>
			 * 	& SharedSignalMethods}
			 */
			const events = addSignalMethods();

			/**
			 * @type Readonly<string[]>
			 */
			let _manualOrder = [];

			/**
			 * @type {Map<string, string>}
			 */
			let _shuffleChoices = new Map;

			/**
			 * @param {typeof _manualOrder} val
			 */
			const setManualOrder = (val) => {
				_manualOrder = val;
				events.emit("changed::manual-order", _manualOrder);
			};

			/**
			 * @type {Exclude<typeof _workspace, undefined>["requestChangeManualOrder"]}
			 */
			const requestChangeManualOrder = ({ type, ...data }) => {
				switch (type) {
				case "move":
					{
						const { src, target } = data;
						const from = _manualOrder.indexOf(src);
						if (from === -1) {
							console.warn("changed::manual-order: non-existent move target");
							break;
						}
						const to = _manualOrder.indexOf(target);
						if (to === -1) {
							console.warn("changed::manual-order: non-existent move target");
							break;
						}
						const newOrder = [..._manualOrder];
						const [draggable] = newOrder.splice(from, 1);
						if (draggable === undefined) {
							console.warn("changed::manual-order: non-existent move target");
							break;
						}
						newOrder.splice(to, 0, draggable);
						setManualOrder(newOrder);
					}
					break;
				default:
					break;
				}
			}

			/**
			 * @type {Exclude<typeof _workspace, undefined>["requestSaveShuffleChoices"]}
			 */
			const requestSaveShuffleChoices = (choices) => {
				_shuffleChoices = choices;
				events.emit("changed::shuffle-choices", choices);
			};

			events.connect("changed::manual-order", (_, newVal) => {
				(async () => {
					const workspaceData = root.get_child(".stobo");
					await makeDirNonstrictAsync(workspaceData);
					const manualOrderFile = workspaceData.get_child("manual-order");
					await replaceJsonAsync(newVal, manualOrderFile);
				})().catch(logError);
			});

			events.connect("changed::shuffle-choices", (_, newVal) => {
				(async () => {
					const workspaceData = root.get_child(".stobo");
					await makeDirNonstrictAsync(workspaceData);
					const dest = workspaceData.get_child("shuffle-choices");
					/**
					 * @type {{ [key: string]: string }}
					 */
					const obj = {};
					console.log(newVal instanceof Map);
					newVal.forEach((val, key) => {
						obj[key] = val;
					});
					await replaceJsonAsync(obj, dest);
				})().catch(logError);
			});

			const savedOrder = await (async () => {
				/**
				 * @type {string[]}
				 */
				let value;
				try {
					value = await loadFromWorkspaceStorage(root, "manual-order");
				} catch (error) {
					logError(error);
					value = [];
				}
				return value;
			})();

			/**
			 * @type {string[]}
			 */
			const newOrder = [];

			const physicalOrderTemp = entries.map(x => x.name);

			for (const index in savedOrder) {
				const x = savedOrder[index];
				if (x === undefined) continue;
				const foundIdx = physicalOrderTemp.indexOf(x);
				if (foundIdx !== -1) {
					newOrder.push(x);
					physicalOrderTemp.splice(foundIdx, 1);
				}
			}

			for (const index in physicalOrderTemp) {
				const x = physicalOrderTemp[index];
				if (x === undefined) continue;
				newOrder.push(x);
			}

			setManualOrder(newOrder);

			const savedShuffleChoices = await (async () => {
				/**
				 * @type {Map<string, string>}
				 */
				let value;
				try {
					value = await loadFromWorkspaceStorage(root, "shuffle-choices");
				} catch (error) {
					logError(error);
					value = new Map;
				}
				return value;
			})();

			_shuffleChoices = savedShuffleChoices;
			events.emit("changed::shuffle-choices", savedShuffleChoices);

			setWorkspace({
				root,
				entries,
				onFsChanged(cb) {
					monitorBindings.push(monitor.connect("changed", cb));
				},
				requestChangeManualOrder,
				get manualOrder() {
					return _manualOrder;
				},
				disconnect: (id) => events.disconnect(id),
				// @ts-expect-error
				connect: (signal, callback) => events.connect(signal, callback),
				requestSaveShuffleChoices,
				get shuffleChoices() {
					return _shuffleChoices;
				},
				destroy() {
					events.disconnectAll();
					for (const x of monitorBindings) {
						monitor.disconnect(x);
					}
				}
			});

			const dirPath = root.get_path();
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
		const profileLabelStack = builder.get_object("profile_label_stack", Gtk.Stack);

		primaryButton.connect("notify::active", syncCreate(() => {
			if (primaryButton.active) {
				profileBar.add_css_class("active");
			} else {
				profileBar.remove_css_class("active");
			}
		}));

		/**
		 * @type {GLib.Source=}
		 */
		let useLabelTimeout = undefined;

		/**
		 * @param {string} _val
		 */
		const toast = (_val) => {
			if (useLabelTimeout !== undefined) useLabelTimeout.destroy();
			profileLabelStack.set_visible_child_name("2");
			// @ts-expect-error
			useLabelTimeout = setTimeout(() => {
				profileLabelStack.set_visible_child_name("1");
			}, 1000);
		};

		return {
			primaryButton,
			profileLabel,
			toast,
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

	const banner = builder.get_object("banner", Adw.Banner);

	events.connect("workspaceChanged", () => {
		if (_workspace === undefined) {
			console.debug("Cannot update banner when there is no workspace");
			return;
		}

		banner.set_revealed(false);

		_workspace.onFsChanged(() => {
			banner.set_revealed(true);
		});
	});

	const addonList = builder.get_object("addon_list", Gtk.ListBox);



	const dropTarget = Gtk.DropTarget.new(Gtk.ListBoxRow.$gtype, Gdk.DragAction.MOVE);
	addonList.add_controller(dropTarget);

	// Drop Handling
	dropTarget.connect("drop", (_drop, value, _x, y) => {
		if (!("srcName" in value) || typeof value.srcName !== "string") throw new Error;

		if (_workspace === undefined) {
			console.debug("Cannot update addon list when there is no workspace");
			return;
		}

		const targetRow = addonList.get_row_at_y(y);
		// If value or the target row is null, do not accept the drop
		if (value === null || targetRow === null) {
			console.debug("Items are null");
			return false;
		}

		if (!("srcName" in targetRow) || typeof targetRow.srcName !== "string") throw new Error;

		const targetIndex = targetRow.get_index();

		addonList.remove(value);
		addonList.insert(value, targetIndex);
		_workspace.requestChangeManualOrder({
			type: "move",
			src: value.srcName,
			target: targetRow.srcName,
		});

		targetRow.set_state_flags(Gtk.StateFlags.NORMAL, true);

		// FIXME(kinten): This will fix a bug where entire view is scrolled to top/bottom on dropping. But now user cannot focus on each row, hurts accessibility.
		addonList.set_can_focus(false);

		// If everything is successful, return true to accept the drop
		return true;
	});


	const headerbarTitle = builder.get_object("headerbar_title", Adw.Clamp);

	const movingDropTarget = Gtk.DropTarget.new(Gtk.ListBoxRow.$gtype, Gdk.DragAction.MOVE);
	headerbarTitle.add_controller(movingDropTarget);

	movingDropTarget.connect("drop", (_drop, _value, _x, _y) => {
		return true;
	});

	const headerbarTitleDragRevealer = builder.get_object("headerbar_title_drag_revealer", Gtk.Revealer);

	movingDropTarget.connect("enter", () => {
		headerbarTitleDragRevealer.set_reveal_child(true);
		headerbarTitle.add_css_class("blurred");
		return Gdk.DragAction.MOVE;
	});

	movingDropTarget.connect("leave", () => {
		headerbarTitleDragRevealer.set_reveal_child(false);
		headerbarTitle.remove_css_class("blurred");
	});

	builder.add_from_resource(AddonDetails.substr(11));

	const addonDetailsWindow = Stobo.Object.assign(
		builder.get_object("addon_details_window", Adw.Window),
		(target) => ({
			title_widget: (() => {
				const content = target.get_content();
				if (!(content instanceof Gtk.Box)) throw new Error;
				const headerbar = content.get_first_child();
				if (!(headerbar instanceof Adw.HeaderBar)) throw new Error;
				const title = headerbar.get_title_widget();
				if (!(title instanceof Adw.WindowTitle)) throw new Error;
				return title;
			})(),
		})
	);
	addonDetailsWindow.set_transient_for(window);

	events.connect("workspaceChanged", () => {
		if (_workspace === undefined) {
			console.debug("Cannot update addon list when there is no workspace");
			return;
		}

		const { entries, manualOrder } = _workspace;

		addonList.remove_all();

		manualOrder.forEach(key => {
			if (_workspace === undefined) {
				console.debug("Cannot update addon list when there is no workspace");
				return;
			}

			const x = entries.find(y => y.name === key);

			if (x === undefined) return;

			const row = Object.assign(new Adw.ActionRow({
				title: x.name,
				activatable: true,
			}), {
				srcName: x.name,
			});

			row.connect("activated",
				/**
				 * @param {typeof row} y
				 */
				y => {
					// FIXME(kinten): This will fix a bug where entire view is scrolled to top/bottom on dropping. But now user cannot focus on each row, hurts accessibility.
					addonList.set_can_focus(true);
					const popover = new Gtk.PopoverMenu;
					popover.set_parent(y);
					popover.set_offset(0, -(y.get_height() / 4));
					popover.set_menu_model((() => {
						const menu = new Gio.Menu;

						menu.append_submenu(_("Move to Index..."), (() => {
							const menu = new Gio.Menu;

							const widgetPlaceholder = new Gio.MenuItem;
							widgetPlaceholder.set_attribute_value("custom", GLib.Variant.new_string("move-to-index-widget"));
							menu.append_item(widgetPlaceholder);

							return menu;
						})())

						const more = new Gio.MenuItem;
						more.set_label(_("Configure"));
						more.set_action_and_target_value("workspace.show-details", GLib.Variant.new_string(y.srcName));

						menu.append_item(more);

						return menu;
					})());

					const container = new Adw.Clamp;
					container.set_maximum_size(120);
					container.set_margin_top(12);
					container.set_margin_bottom(12);

					container.set_child((() => {
						const box = new Gtk.Box;
						box.add_css_class("linked");

						const entry = new Gtk.Entry;
						entry.set_size_request(56, -1);
						box.append(entry);

						box.append((() => {
							const button = new Gtk.Button;
							button.set_label(_("Move"));
							button.add_css_class("suggested-action");
							button.connect("clicked", () => {
								if (_workspace === undefined) return;

								const targetIdx = Math.min(Math.max(Number(entry.text), 0), _workspace.manualOrder.length - 1);
								const targetRow = addonList.get_row_at_index(targetIdx);
								if (targetRow === null) return;
								if (!("srcName" in targetRow) || typeof targetRow.srcName !== "string") return;

								addonList.remove(y);
								addonList.insert(y, targetIdx);

								_workspace.requestChangeManualOrder({
									type: "move",
									src: row.srcName,
									target: targetRow.srcName,
								});

								addonList.set_can_focus(false);

								popover.set_visible(false);
							})
							return button;
						})());

						return box;
					})());

					popover.add_child(container, "move-to-index-widget");

					popover.set_visible(true);
				}
			);

			if ("enabled" in x && x.enabled === false) {
				row.add_css_class("dim-label");
			}

			if ("shuffleGroup" in x && x.shuffleGroup !== null) {
				const { shuffleGroup } = x;
				const button = new Gtk.Button();
				button.set_valign(Gtk.Align.CENTER);
				button.set_label(shuffleGroup);
				button.add_css_class("tag");
				row.add_suffix(button);

				_workspace.connect("changed::shuffle-choices", syncCreate((_, newVal) => {
					const choice = newVal.get(shuffleGroup);
					if (choice === undefined) return;
					button.set_tooltip_text(`Last choice: ${choice}`);
				}, null, _workspace.shuffleChoices));
			}

			if ("note" in x && x.note !== null) {
				const { note } = x;
				const info = new Gtk.Button();
				info.set_valign(Gtk.Align.CENTER);
				info.set_tooltip_text(note);
				info.add_css_class("flat");
				info.set_icon_name("info-symbolic");
				row.add_suffix(info);
			}

			let dragX = NaN;
			let dragY = NaN;

			const dropController = new Gtk.DropControllerMotion;

			const dragSource = new Gtk.DragSource({
				actions: Gdk.DragAction.MOVE,
			});

			row.add_controller(dragSource);
			row.add_controller(dropController);

			// Drag handling
			dragSource.connect("prepare", (_source, x, y) => {
				dragX = x;
				dragY = y;

				const value = new GObject.Value();
				value.init(Gtk.ListBoxRow.$gtype);
				value.set_object(row);

				return Gdk.ContentProvider.new_for_value(value);
			});

			dragSource.connect("drag-begin", (_source, drag) => {
				const dragWidget = new Gtk.ListBox();

				dragWidget.set_size_request(row.get_width(), row.get_height());
				dragWidget.add_css_class("boxed-list");

				const dragRow = new Adw.ActionRow({ title: row.title });
				dragRow.add_prefix(
					new Gtk.Image({
						iconName: "list-drag-handle-symbolic",
						cssClasses: ["dim-label"],
					}),
				);

				dragWidget.append(dragRow);
				dragWidget.drag_highlight_row(dragRow);

				const icon = Gtk.DragIcon.get_for_drag(drag);
				// @ts-expect-error
				icon.child = dragWidget;

				drag.set_hotspot(dragX, dragY);
			});

			// Update row visuals during DnD operation
			dropController.connect("enter", () => {
				addonList.drag_highlight_row(row);
			});

			dropController.connect("leave", () => {
				addonList.drag_unhighlight_row();
			});

			addonList.append(row);
		});
	});

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
				actionTarget: GLib.Variant.new_string(x.name),
			});

			const row = new Adw.ActionRow({
				title: x.name,
				activatableWidget: button,
			});

			row.add_suffix(button);

			matcherList.append(row);
		});
	});

	const workspaceActions = new Gio.SimpleActionGroup();

	const add = new Gio.SimpleAction({
		name: "add",
	});

	add.connect("activate", () => {
		folderStack.set_visible_child_name("pre-folder");
	});

	workspaceActions.add_action(add);

	const restore = new Gio.SimpleAction({
		name: "restore",
	});

	restore.connect("activate", () => {
		const path = _recentWorkspaces[0];
		if (path === undefined) throw new Error;
		const file = Gio.File.new_for_path(makeCanonicalPath(path));
		updateWorkspace(file);
	});

	workspaceActions.add_action(restore);

	const reload = new Gio.SimpleAction({
		name: "reload",
	});

	reload.connect("activate", () => {
		if (_workspace === undefined) {
			console.warn("Cannot reload when there is no workspace");
			return;
		}
		updateWorkspace(_workspace.root);
	});

	workspaceActions.add_action(reload);

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

	workspaceActions.add_action(exportList);

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
		updateWorkspace(file);
	});

	events.connect("workspaceChanged", () => {
		switchTo.change_state(GLib.Variant.new_string(_workspace?.root?.get_basename() || ""));
	});

	switchTo.connect("change-state", (action, value) => {
		if (value === null) throw new Error;
		action.set_state(value);
	});

	workspaceActions.add_action(switchTo);

	const showDetails = new Gio.SimpleAction({
		name: "show-details",
		parameterType: GLib.VariantType.new("s"),
	});

	showDetails.connect("activate", (_action, parameter) => {
		if (parameter === null) throw new Error;
		const [val] = parameter.get_string();
		addonDetailsWindow.title_widget.set_title(val);
		addonDetailsWindow.present();
	});

	workspaceActions.add_action(showDetails);

	window.insert_action_group("workspace", workspaceActions);

	application.set_accels_for_action("workspace.add", ["<Primary>O"]);

	const headerboxActions = new Gio.SimpleActionGroup();

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

	headerboxActions.add_action(headerbox_reveal);

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

	headerboxActions.add_action(headerbox_box_switch);

	window.insert_action_group("headerbox", headerboxActions);

	const injectActions = new Gio.SimpleActionGroup();

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
			const { root, entries, shuffleChoices: previousShuffleChoices, requestSaveShuffleChoices } = _workspace;
			const { files: archives, shuffleChoices } = filter(entries, previousShuffleChoices);
			requestSaveShuffleChoices(shuffleChoices);
			await link(root, archives, cancellable);
			profileBar.toast("LJWsdf");
		})().catch(logError);
	});

	injectActions.add_action(inject);

	window.insert_action_group("inject", injectActions);

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
		short: _("Work-in-progress"),
		msg: _("This application is in heavy development. All feedbacks are welcomed!"),
	});

	return window;
};

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

/**
 * @type {Adw.PreferencesWindow?}
 */
let preferencesWindow = null;

const showPreferences = new Gio.SimpleAction({
	name: "show-preferences",
});

showPreferences.connect("activate", () => {
	if (preferencesWindow === null) {
		const newWindow = createPreferences();

		newWindow.connect("close-request", () => {
			preferencesWindow = null;
			return false;
		});

		preferencesWindow = newWindow;
	}
	preferencesWindow.present();
});

application.add_action(showPreferences);

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

export {
	settings,
};

export default application;
