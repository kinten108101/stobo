import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import Pango from "gi://Pango";
import Adw from "gi://Adw";
import { gettext as _ } from "gettext";

import extendBuilder from "./lib/builder.js";
import { logWhenCatch, syncCreate } from "./lib/functional.js";
import { addError } from "./services/status.js";
import Window from "./window.blp" with { type: "uri" };
import add from "./add.blp" with { type: "uri" };
import AddonDetails from "./addonDetails.blp" with { type: "uri" };
import AddonControls from "./addonControls.blp" with { type: "uri" };
import Preferences from "./preferences.blp" with { type: "uri" };
import HeaderBox, { bindStatusToHeaderboxSection } from "./legacy/headerbox.js";
import { defaultDecoder, defaultEncoder, isDirAsync, listFileAsync, makeDirNonstrictAsync, readJsonAsync, replaceJsonAsync } from "./lib/fileIO.js";
import TOML from "./lib/fast-toml.js";
import useFile from "./lib/file.js";
import ExtendedBuilder from "./lib/builder.js";
import { addSignalMethods } from "./lib/signals.js";
import { StoboColumnItem } from "./classes/stoboColumn.js";
import ProfileBar from "./classes/profileBar.js";
import StoboProfile from "./functionComponents/stoboProfile.js";
import delayMs from "./lib/delayMs.js";
import DocumentChooser, { DocumentEntry, DocumentRow } from "./classes/documentChooser.js";
import Embed from "./classes/embed.js";
import StoboColumnView from "./functionComponents/stoboColumnView.js";
import { MissingWorkspace } from "./error.js";

const T_CLOSURE_NONE = /** @type {GObject.TClosure} */(/** @type {unknown} */(null));

/**
 * @param {string} uri
 */
async function _import(uri) {
	return import(uri);
}

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
			// @ts-expect-error WTF
			return Object.assign(src, props(src));
		},
	}
};

function forceRefresh(x) {
	if (x === _import) {
		/**
		 * param {string} path
		 */
		return async function (uri) {
			const file = Gio.File.new_for_uri(uri);
			const [bytes] = await file.load_contents_async(null);
			const str = defaultDecoder.decode(bytes).split("\n").map(x => {
				return String(x).replaceAll("export default", "var exports_default =");
			}).reduce((acc, x) => acc + x, "").concat("return { default: exports_default };");
			return Function(str)();
		};
	} else throw new Error;
}

/**
 * @param {{ get_height(): number }} view
 * @param {Gio.ListModel} model
 * @param {number} y
 */
function getIndex(view, model, y) {
	return Math.round(((y - 35) / (view.get_height() - 35)) * (model.get_n_items() - 1));
}

/**
 * @template {any[]} K
 * @template {(...args: K) => Promise<void>} T
 * @param {T} x
 */
function nowait(x) {
	/**
	 * @type {(...args: K) => void}
	 */
	const a = (...args) => {
		x(...args).catch(logError);
	};

	return a;
}

// @ts-expect-error
const AdwCallbackAnimationTarget = new Proxy(class extends Adw.CallbackAnimationTarget {
	/**
	 * @param {{ callback: (value: number) => void }} _args
	 */
	// @ts-expect-error
	constructor(_args) {}
}, {
	/**
	 * @param {[{ callback: (value: number) => void }]} argsArray
	 */
	construct(_target, argsArray, _newTarget) {
		const [params] = argsArray;
		const { callback } = params;
		// @ts-expect-error
		return Adw.CallbackAnimationTarget.new(callback);
	},
});

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
function getDestinationDir(gameDir) {
	return gameDir.get_child("left4dead2").get_child("addons");
}

/**
 * @param {string} path
 */
function makeCanonicalPath(path) {
	const homeDir = GLib.get_home_dir();
	const newVal = GLib.canonicalize_filename(path.replace("~", homeDir), null);
	return newVal;
}

/**
 * @param {string} canonicalPath
 */
function collapsePath(canonicalPath) {
	const homeDir = GLib.get_home_dir();
	const newVal = canonicalPath.replace(homeDir, "~");
	return newVal;
}

/**
 * @param {Gio.Cancellable | null} cancellable
 */
async function cleanup(cancellable) {
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
}

/**
 * @param {Gio.File} root
 * @param {Gio.File[]} archives
 * @param {{ addLine(line: string): void; }} updateSuite
 * @param {Gio.Cancellable | null} cancellable
 */
async function link(root, archives, { addLine }, cancellable) {
	const preGameDir = settings.get_string("game-dir");
	const gameDir = Gio.File.new_for_path(makeCanonicalPath(preGameDir));
	const destDir = getDestinationDir(gameDir);
	let index = 0;
	for (const _index in archives) {
		const x = archives[_index];
		if (x === undefined) continue;
		if (await isDirAsync(x)) {
			addLine(`Discovered that ${x.get_basename()} is a folder`);
			const subarchives = (await listFileAsync(x)).filter(x => {
				const path = x.get_path();
				if (path === null) return false;
				return path.includes(".vpk", path.length - 4);
			});
			for (const subindex in subarchives) {
				const y = subarchives[subindex];
				if (y === undefined) continue;
				const destName = `${index++}@stvpk.vpk`;
				const dest = destDir.get_child(destName);
				const symlinkValue = y.get_path();
				if (symlinkValue === null) {
					console.warn("source-path-missing");
					continue;
				}
				try {
					await dest.make_symbolic_link_async(symlinkValue, GLib.PRIORITY_DEFAULT, cancellable);
					addLine(`Linked ${x.get_basename()}/${y.get_basename()} as ${destName}`);
				} catch (error) {
					logError(error);
					continue;
				}
			}
		} else {
			const destName = `${index++}@stvpk.vpk`;
			const dest = destDir.get_child(destName);
			const symlinkValue = x.get_path();
			if (symlinkValue === null) {
				console.warn("source-path-missing");
				continue;
			}
			try {
				await dest.make_symbolic_link_async(symlinkValue, GLib.PRIORITY_DEFAULT, cancellable);
				addLine(`Linked ${x.get_basename()} as ${destName}`);
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
}

/**
 * @param {(Awaited<ReturnType<typeof loadFolder>>)} entries
 * @param {Readonly<Map<string, string>>} previousShuffleChoices
 */
function filter(entries, previousShuffleChoices) {
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
			if (preShuffleFiles.length <= 1) return preShuffleFiles;
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
}

const xattrNamespace = "user.stobo";

/**
 * @param {Gio.File} file
 */
async function getExtendedAttributeDumpFromFile(file) {
	const buffer = /** @type {{[key: string]: string}} */({});
	const path = file.get_path();
	if (path === null) return buffer;
	const process = Gio.Subprocess.new([
		"getfattr", "-m", `^${xattrNamespace}.`, "-d", path
	], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);

	const [stdout] = await process.communicate_utf8_async(null, null);

	if (process.get_successful() && stdout !== null) {
		const lines = stdout.split("\n").filter((_, i, arr) => i > 0 && i <= arr.length - 2);
		for (const x of lines) {
			const parts = x.split("=");
			if (parts.length !== 2) continue;
			let key = parts[0];
			if (key === undefined) throw new Error;
			key = key.substring(xattrNamespace.length + 1, key.length);
			let value = parts[1];
			if (value === undefined) throw new Error;
			if (value[0] === "\"") value = value.substring(1, value.length);
			if (value[value.length - 1] === "\"") value = value.substring(0, value.length - 1);
			buffer[key] = value;
		}
	}
	return buffer;
}

/**
 * @param {Gio.File} dir
 * @param {{
 * listFileAsync: (dir: Gio.File) => Promise<Gio.File[]>;
 * }} params
 */
async function loadFolder(dir, { listFileAsync }) {
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
				}) || null;
				const value = await (async () => {
					if (manifest === null) {
						const value = await getExtendedAttributeDumpFromFile(x);

						const enabled = (() => {
							if (!("enabled" in value)) return null;
							return value["enabled"] === "true";
						})();
						const steamId = (() => {
							if (!("steam-id" in value)) return null;
							const numberCanNaN = Number(value["steam-id"]);
							if (isNaN(numberCanNaN)) return null;
							return numberCanNaN;
						})();
						const note = (() => {
							if (!("note" in value)) return null;
							return value["note"];
						})();
						const shuffleGroup = (() => {
							if (!("shuffle-group" in value)) return null;
							return value["shuffle-group"];
						})();

						return {
							enabled,
							steamId,
							note,
							shuffleGroup,
						};
					} else {
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
					}
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
}

/**
 * @param {Gio.File} root
 * @param {{ entries: Awaited<ReturnType<typeof loadFolder>> }} workspace
 */
async function exportAsList(root, { entries }) {
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
}

globalThis.exportAsList = exportAsList;

/**
 * @param {Gio.File} root
 */
async function measureDiskUsage(root) {
	/** @type {Gio.File[]} */
	const files = [];
	const targets = [root];
	while (targets.length > 0) {
		const [head] = targets.splice(0, 1);
		if (head === undefined) throw new Error;
		for (const x of await listFileAsync(head)) {
			const buffer = (await isDirAsync(x)) ? targets : files;
			buffer.push(x);
		}
	}
	return (await Promise.all(
		files.map(x => x.query_info_async("*", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null).then(x => x.get_size(), _ => 0))
	)).reduce((acc, x) => acc + x, 0);
}

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
function pushRecentWorkspace(val) {
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
}

/**
 * @param {Gio.File} root
 * @param {"manual-order" | "shuffle-choices" | "log"} filename
 */
async function writeToWorkspaceStorage(root, filename) {
	const workspaceData = root.get_child(".stobo");
	await makeDirNonstrictAsync(workspaceData);
	switch (filename) {
	case "log":
		return 1;
	default:
		throw new Error;
	}
}

/**
 * @param {Gio.File} root
 * @param {"manual-order" | "shuffle-choices" | "log"} filename
 */
async function loadFromWorkspaceStorage(root, filename) {
	const workspaceData = root.get_child(".stobo");
	await makeDirNonstrictAsync(workspaceData);
	const file = workspaceData.get_child(filename);
	const content = await (async () => {
		switch (filename) {
		case "manual-order":
			return await (async () => {
				const content = await readJsonAsync(file);

				if (!Array.isArray(content)) throw new Error;
				if (!(
					/**
					 * @param {any[]} x
					 * @returns {x is string[]}
					 */
					function (x) {
						return x.some(y => typeof y === "string");
					}
				)(content)) throw new Error;

				for (const index in content) {
					const x = content[index];
					if (typeof x !== "string") throw new Error;;
				}

				return { filename, content };
			})();
		case "shuffle-choices":
			return await (async () => {
				const raw = await readJsonAsync(file);

				if (typeof raw !== "object") throw new Error;

				const content = (() => {
					const val = new Map([["", ""]]);

					for (const key in raw) {
						const x = raw[key];
						if (typeof x !== "string") throw new Error;
						val.set(key, x);
					}

					return val;
				})();

				return { filename, content };
			})();
		case "log":
			return await (async () => {
				const content = await file.query_info_async("*", Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
				const modificationTime = new Date(content.get_modification_time().tv_sec * 1000);

				return {
					filename,
					content: {
						modificationTime,
					}
				};
			})();
		default:
			throw new Error;
		}
	})();

	return content;
}

/**
 * @param {Gio.File} root
 */
export async function loadWorkspace(root) {
	const entries = await loadFolder(root, { listFileAsync });

	const monitor = root.monitor_directory(Gio.FileMonitorFlags.NONE, null);

	/**
	 * @type {number[]}
	 */
	const monitorBindings = [];

	/**
	 * @type {{}
	 * 	& Signal<"changed::manual-order", [typeof _manualOrder]>
	 * 	& Signal<"changed::shuffle-choices", [typeof _shuffleChoices]>
	 *  & Signal<"changed::last-build", [typeof _lastBuild]>
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
	 * @type {Date?}
	 */
	let _lastBuild = null;

	/**
	 * @param {typeof _manualOrder} val
	 */
	const setManualOrder = (val) => {
		_manualOrder = val;
		events.emit("changed::manual-order", _manualOrder);
	};

	/**
	 * @param {Date?} val
	 */
	const setLastBuild = Object.assign(function (val) {
		_lastBuild = val;
		events.emit("changed::last-build", val);
	}, {
		silently: () => (
			/**
		 	 * @param {Date?} val
		 	 */
			function (val) {
				_lastBuild = val;
			})
	});

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
			newVal.forEach((val, key) => {
				obj[key] = val;
			});
			await replaceJsonAsync(obj, dest);
		})().catch(logError);
	});

	events.connect("changed::last-build", (_, _newVal) => {
		(async () => {
			const workspaceData = root.get_child(".stobo");
			await makeDirNonstrictAsync(workspaceData);
			const manualOrderFile = workspaceData.get_child("log");
			await replaceJsonAsync({}, manualOrderFile);
		})().catch(logError);
	});

	const savedOrder = await (async () => {
		try {
			const { filename, content: value } = await loadFromWorkspaceStorage(root, "manual-order");
			if (filename !== "manual-order") throw new Error;
			return value;
		} catch (error) {
			if (error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {

			} else {
				logError(error);
			}
			return [];
		}
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
		try {
			const { filename, content: value } = await loadFromWorkspaceStorage(root, "shuffle-choices");
			if (filename !== "shuffle-choices") throw new Error;
			return value;
		} catch (error) {
			if (error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {

			} else {
				logError(error);
			}
			return new Map([["", ""]]);
		}
	})();

	const savedLog = await (async () => {
		try {
			const { filename, content: value } = await loadFromWorkspaceStorage(root, "log");
			if (filename !== "log") throw new Error;
			return value;
		} catch (error) {
			if (error instanceof GLib.Error && error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {

			} else {
				logError(error);
			}
			return {
				modificationTime: null
			}
		}
	})();

	setLastBuild.silently()(savedLog.modificationTime);

	return {
		root,
		entries,
		/**
		 * @param {() => void} cb
		 */
		onFsChanged(cb) {
			monitorBindings.push(monitor.connect("changed", cb));
		},
		/**
		 * @param {{
	 	 * 		type: "move";
	 	 * 		src: string;
	 	 *  	target: string;
		 * }} params
		 */
		requestChangeManualOrder: function ({ type, ...data }) {
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
				break;
			}
			default:
				break;
			}
		},
		get manualOrder() {
			return _manualOrder;
		},
		/**
		 * @param {number} id
		 */
		_disconnect: (id) => events.disconnect(id),
		/**
		 * @param {string} signal
		 * @param {(...args: any[]) => void} callback
		 */
		// @ts-expect-error
		_connect: (signal, callback) => events.connect(signal, callback),
		requestSaveShuffleChoices: syncCreate(
			/**
			 * @param {ReturnType<typeof filter>["shuffleChoices"]} choices
			 */
			function (choices) {
				_shuffleChoices = choices;
				events.emit("changed::shuffle-choices", choices);
			},
			savedShuffleChoices
		),
		get shuffleChoices() {
			return _shuffleChoices;
		},
		setLastBuild,
		get lastBuild() {
			return _lastBuild;
		},
		destroy() {
			events.disconnectAll();
			for (const x of monitorBindings) {
				monitor.disconnect(x);
			}
		}
	};
}

/**
 * @param {Gtk.Stack} folderStack
 * @param {{
 * setWorkspace(param: any): void;
 * }} workspaceBuffer
 */
function updateWorkspace(folderStack, { setWorkspace }) {
	/**
	 * @param {Gio.File} root
	 */
	return function (root) {
		folderStack.set_visible_child_name("has-folder");
		(async () => {
			const draft = await loadWorkspace(root);

			setWorkspace(draft);

			const dirPath = root.get_path();
			if (dirPath === null) throw new Error;

			pushRecentWorkspace(collapsePath(dirPath));
		})().catch(logError);
	}
}

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
	 * @type {Readonly<Awaited<ReturnType<typeof loadWorkspace>>>=}
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

	files.output_signals.connect("changed::workspace", (_, __, dir) => {
		updateWorkspace(folderStack, { setWorkspace })(dir);
	});

	const headerbox = HeaderBox(builder);

	events.connect("workspaceChanged", syncCreate(logWhenCatch(() => {
		// TODO(kinten): Empty workspace data? When? How is UI?
		if (_workspace === undefined) throw new MissingWorkspace;
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
	})));

	const { content: profileBar } = builder.get_object("profile_bar", ProfileBar);

	bindStatusToHeaderboxSection(headerbox, { profileLabel: profileBar.label }, window);

	const banner = builder.get_object("banner", Adw.Banner);
	const stoboBanner = builder.get_object("stobo_banner", Adw.Banner);

	events.connect("workspaceChanged", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;

		banner.set_revealed(false);
		stoboBanner.set_revealed(false);

		_workspace.onFsChanged(() => {
			banner.set_revealed(true);
			stoboBanner.set_revealed(true);
		});
	}));

	const addonList = builder.get_object("addon_list", Gtk.ListBox);

	const dropTarget = Gtk.DropTarget.new(Gtk.ListBoxRow.$gtype, Gdk.DragAction.MOVE);
	addonList.add_controller(dropTarget);

	// Drop Handling
	dropTarget.connect("drop", logWhenCatch((_drop, value, _x, y) => {
		if (!("srcName" in value) || typeof value.srcName !== "string") throw new Error;

		if (_workspace === undefined) throw new MissingWorkspace;

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
	}));

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

	const popover = new Gtk.PopoverMenu;

	events.connect("workspaceChanged", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;

		const { entries, manualOrder } = _workspace;

		addonList.remove_all();

		manualOrder.forEach(key => {
			if (_workspace === undefined) throw new MissingWorkspace;

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
					const menu = (() => {
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
					})();
					popover.set_menu_model(menu);
					// NOTE(kinten): Previously a popover is created per activation, and it unparents based on the notify::visible signal (when false value). But that approach conflicted with the GAction system because (ASSUMPTION) the current element cannot traverse up ancestor tree to find action provider if it unparents before traversal.
					popover.unparent();
					popover.set_parent(y);
					popover.set_offset(0, -(y.get_height() / 4));
					popover.set_menu_model(menu);

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

					// NOTE(kinten): add child to popover menu AFTER adding placeholder gmenu item
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

				if (_workspace === undefined) throw new MissingWorkspace;
				_workspace._connect("changed::shuffle-choices", syncCreate((_, newVal) => {
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
	}));

	const stoboColumnBuffer = new Gio.ListStore({ itemType: StoboColumnItem.$gtype });

	(column => {
		const factory = column.get_factory();

		if (!(factory instanceof Gtk.SignalListItemFactory)) throw new Error;

		factory.connect("setup", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const label = new Gtk.Label();
			label.add_css_class("dim-label");
			listItem.set_child(label);
		});

		factory.connect("bind", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const { child: widget, item: modelItem } = listItem;
			if (!(widget instanceof Gtk.Label)) throw new Error;
			const idx = (() => {
				const [found, idx] = stoboColumnBuffer.find(modelItem);
				if (found) return idx;
				else return NaN;
			})();
			if (isNaN(idx)) throw new Error;
			widget.set_label(String(idx));
		});
	})(builder.get_object("stobo_column_0", Gtk.ColumnViewColumn));

	(column => {
		const factory = column.get_factory();

		if (!(factory instanceof Gtk.SignalListItemFactory)) throw new Error;

		factory.connect("setup", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const box = new Gtk.Box();
			const label = new Gtk.Label({
				halign: Gtk.Align.START,
			});
			label.set_ellipsize(Pango.EllipsizeMode.END);
			box.append(label);
			listItem.set_child(box);
		});

		factory.connect("bind", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const { child: widget, item: modelItem } = listItem;
			if (!(widget instanceof Gtk.Box)) throw new Error;
			(() => {
				const label = widget.get_first_child();
				if (!(label instanceof Gtk.Label)) throw new Error;
				(() => {
					if (!("entry" in modelItem) || !(modelItem.entry instanceof WeakRef)) throw new Error;
					const item = modelItem.entry.deref();
					if (typeof item !== "object" || item === null) throw new Error;
					if (!("name" in item) || typeof item["name"] !== "string") throw new Error;
					label.set_label(item["name"]);
					(() => {
						if (!("enabled" in item) || typeof item["enabled"] !== "boolean") {
							return;
						}
						if (!item["enabled"]) widget.add_css_class("dim-label");
					})();
					(() => {
						if (!("note" in item) || typeof item["note"] !== "string") return true;
						widget.set_tooltip_text(`${item["name"]}\n\n${item["note"]}`);
						return false;
					})() && (() => {
						widget.set_tooltip_text(item["name"])
					})();
				})();
			})();
		});

		factory.connect("unbind", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const { child: widget, item: modelItem } = listItem;
			widget.remove_css_class("dim-label");
			if (!(widget instanceof Gtk.Box)) throw new Error;
			(() => {
				if (!("entry" in modelItem) || !(modelItem.entry instanceof WeakRef)) return;
				const item = modelItem.entry.deref();
				if (typeof item !== "object" || item === null) return;
				(() => {
					if (!("name" in item) || typeof item["name"] !== "string") return;
					widget.set_tooltip_text(item["name"]);
				})();
			})();
		});
	})(builder.get_object("stobo_column_2", Gtk.ColumnViewColumn));

	(column => {
		const factory = column.get_factory();

		if (!(factory instanceof Gtk.SignalListItemFactory)) throw new Error;

		factory.connect("setup", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const label = new Gtk.Label;
			label.add_css_class("dim-label");
			label.set_halign(Gtk.Align.START);
			listItem.set_child(label);
		});

		factory.connect("bind", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const { child: widget, item: modelItem } = listItem;
			if (!(widget instanceof Gtk.Label)) throw new Error;
			(() => {
				if (!("entry" in modelItem) || !(modelItem.entry instanceof WeakRef)) return;
				const item = modelItem.entry.deref();
				if (typeof item !== "object" || item === null) return;
				(() => {
					if (!("shuffleGroup" in item) || typeof item["shuffleGroup"] !== "string") return;
					widget.set_label(item["shuffleGroup"]);
					widget.set_tooltip_text(item["shuffleGroup"]);
				})();
			})();
		});

		factory.connect("unbind", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const { child: widget } = listItem;
			if (!(widget instanceof Gtk.Label)) throw new Error;
			widget.set_label("");
			widget.set_tooltip_text("");
		});
	})(builder.get_object("stobo_column_shuffle_group", Gtk.ColumnViewColumn));

	(column => {
		const factory = column.get_factory();

		if (!(factory instanceof Gtk.SignalListItemFactory)) throw new Error;

		factory.connect("setup", (_self, listItem) => {
			if (!(listItem instanceof Gtk.ListItem)) throw new Error;
			const icon = new Gtk.Image({
				iconName: "list-drag-handle-symbolic",
			});
			icon.add_css_class("dim-label");
			listItem.set_child(icon);
		});
	})(builder.get_object("stobo_column_3", Gtk.ColumnViewColumn));

	const stoboColumnSelection = new Gtk.SingleSelection({
		model: stoboColumnBuffer
	});

	const stoboColumnView = StoboColumnView(
		builder,
		stoboColumnSelection,
		stoboColumnBuffer,
		window,
		() => _workspace
	);

	const contextMenu = (() => {
		const object = new Gtk.PopoverMenu;
		object.set_has_arrow(false);
		return object;
	})();

	/**
	 * @param {{ x: number; y: number }} position
	 * @param {number} sourceIndex
	 */
	const popupContextMenu = (position, sourceIndex) => {
		const { x, y } = position;

		/**
		 * @type {{ [key: string]: () => Gtk.Widget}}
		 */
		const customWidgets = {};
		const menu = (() => {
			const menu = new Gio.Menu;

			!isNaN(sourceIndex) && menu.append_submenu(_("Move to Index..."), (() => {
					const menu = new Gio.Menu;

					const widgetPlaceholder = new Gio.MenuItem;
					widgetPlaceholder.set_attribute_value("custom", GLib.Variant.new_string("move-to-index-widget"));
					customWidgets["move-to-index-widget"] = () => {
						const container = new Adw.Clamp;
						container.set_maximum_size(60);
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

									const sourceRow = stoboColumnBuffer.get_item(sourceIndex);
									if (sourceRow === null) throw new Error;
									if (!("entryName" in sourceRow) || typeof sourceRow["entryName"] !== "string") throw new Error;

									const targetIdx = Math.min(Math.max(Number(entry.text), 0), _workspace.manualOrder.length - 1);
									const targetRow = stoboColumnBuffer.get_item(targetIdx);
									if (targetRow === null) throw new Error;
									if (!("entryName" in targetRow) || typeof targetRow["entryName"] !== "string") throw new Error;

									stoboColumnBuffer.remove(sourceIndex);
									stoboColumnBuffer.insert(targetIdx, sourceRow);

									_workspace.requestChangeManualOrder({
										type: "move",
										src: sourceRow["entryName"],
										target: targetRow["entryName"],
									});

									contextMenu.set_visible(false);
								});
								return button;
							})());

							return box;
						})());
						return container;
					};
					menu.append_item(widgetPlaceholder);

					return menu;
				})());

			menu.append_item((() => {
				const x = new Gio.MenuItem;
				x.set_label(_("Properties"));
				x.set_action_and_target_value("workspace.show-properties", GLib.Variant.new_int32(sourceIndex));
				return x;
			})());


			return menu;
		})();

		contextMenu.set_menu_model(menu);
		contextMenu.unparent();
		contextMenu.set_parent(stoboColumnView);
		contextMenu.set_pointing_to((() => {
			const val = new Gdk.Rectangle();
			val.x = x;
			val.y = y;
			val.width = 1;
			val.height = 1;
			return val;
		})());
		contextMenu.set_menu_model(menu);
		Object.keys(customWidgets).forEach(
			/**
			 * @this {typeof customWidgets}
			 */
			function (key) {
				const x = this[key];
				if (x === undefined) return;
				contextMenu.add_child(x(), key);
			}, customWidgets);

		contextMenu.set_visible(true);
	};

	const listRightClick = new Gtk.GestureClick();
	listRightClick.set_button(3);
	listRightClick.set_propagation_phase(Gtk.PropagationPhase.BUBBLE);
	listRightClick.connect("pressed", (_object, nPress, x, y) => {
		(() => {
			if (nPress !== 1) {
				return;
			}

			const idx = Math.round(((y - 35) / (stoboColumnView.get_height() - 35)) * (stoboColumnBuffer.get_n_items() - 1));

			stoboColumnSelection.set_selected(idx);

			if (idx < 0 || idx >= stoboColumnBuffer.get_n_items()) {
				throw new Error("impossible idx " + idx);
				return;
			}

			const modelItem = stoboColumnBuffer.get_item(idx);
			if (modelItem === null) {
				return;
			}

			popupContextMenu({ x, y }, idx);
		})();
		listRightClick.reset();
	});
	stoboColumnView.add_controller(listRightClick);

	const windowLeftClick = new Gtk.GestureClick();
	windowLeftClick.set_button(1);
	windowLeftClick.set_propagation_phase(Gtk.PropagationPhase.BUBBLE);
	windowLeftClick.connect("pressed", (object, nPress) => {
		(() => {
			if (nPress !== 1) return;
			stoboColumnSelection.set_selected(Gtk.INVALID_LIST_POSITION);
		})();
		object.reset();
	});
	window.add_controller(windowLeftClick);

	const windowRightClick = new Gtk.GestureClick();
	windowRightClick.set_button(3);
	windowRightClick.set_propagation_phase(Gtk.PropagationPhase.BUBBLE);
	windowRightClick.connect("pressed", (object, nPress, x, y) => {
		(() => {
			if (nPress !== 1) return;
			stoboColumnSelection.set_selected(Gtk.INVALID_LIST_POSITION);
			popupContextMenu({ x, y }, NaN);
		})();
		object.reset();
	});
	window.add_controller(windowRightClick);

	events.connect("workspaceChanged", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;

		const { entries, manualOrder } = _workspace;

		const newItems = manualOrder.map(function (key){
			const x = entries.find(y => y.name === key);

			if (x === undefined) return null;

			return Object.assign(new StoboColumnItem({ entryName: x.name }), { entry: new WeakRef(x) });
		}, _workspace)
			.filter(
				/**
				 * @template T
				 * @param {T | null} x
				 * @returns {x is T}
				 */
				x => x !== null);

		stoboColumnBuffer.splice(0, stoboColumnBuffer.get_n_items(), newItems);
	}));

	const matcherList = builder.get_object("matcher_list", Gtk.ListBox);

	events.connect("workspaceChanged", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;

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
	}));

	(/** @type {Gtk.Window} */ (window)).connect("close-request", () => {
		popover.unparent();
	});

	const { content: stoboProfileBar } = builder.get_object("stobo_profile_bar", ProfileBar);

	const stoboProfile = StoboProfile(stoboProfileBar);

	stoboProfile.onPopoverClosed(() => {
		stoboProfileBar.primaryButton.activate_action("headerbox.reveal", null);
	});

	let useLastBuild = NaN;

	events.connect("workspaceChanged", nowait(async () => {
		if (_workspace === undefined) throw new MissingWorkspace;
		const { root, entries, lastBuild, _connect, _disconnect } = _workspace;
		if (!isNaN(useLastBuild)) {
			_disconnect(useLastBuild);
		}
		useLastBuild = _connect("changed::last-build", syncCreate((_, newval) => {
			stoboProfile.updateBuildInfo(newval === null ? null : { lastBuild: newval });
		}, null, lastBuild));
		const name = root.get_basename();
		if (name === null) return;
		stoboProfileBar.label.set_label(name);
		stoboProfile.configure(name, entries.length, await measureDiskUsage(root));
	}));

	const workspaceActions = new Gio.SimpleActionGroup();

	const showProperties = new Gio.SimpleAction({
		name: "show-properties",
		parameterType: GLib.VariantType.new("i"),
	});

	showProperties.connect("activate", logWhenCatch((_, parameter) => {
		if (_workspace === undefined) throw new MissingWorkspace;
		const { entries, manualOrder } = _workspace;

		if (parameter === null) throw new Error;
		const index = parameter.get_int32();

		const x = (() => {
			const name = manualOrder[index];
			if (name === undefined) return null;
			const item = entries.find(x => {
				return x.name === name;
			});
			if (item === undefined) return null;
			return item;
		})();

		if (x === null) throw new Error;

		const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(AddonControls.substring(11)));
		// @ts-expect-error libadwaita 1.5 typelib not available yet
		const dialog = builder.get_object("window", Adw.Dialog);
		useFile(dialog, builder, window);
		(() => {
			if (!("name" in x) || typeof x.name !== "string") return;
			const title = builder.get_object("title", Adw.WindowTitle);
			title.set_title(x.name);
		})();
		(() => {
			if (!("archive" in x) || !(x["archive"] instanceof Gio.File)) return;
			const path = x.archive.get_path();
			if (path === null) return;
			const showArchiveButton = builder.get_object("show_archive_button", Gtk.Button);
			showArchiveButton.set_action_target_value(GLib.Variant.new_tuple([GLib.Variant.new_string(path)]));
			showArchiveButton.connect_after("clicked", () => {
				dialog.close();
			});
		})();
		dialog.present(window);

		return;
	}));

	workspaceActions.add_action(showProperties);

	const addAddon = new Gio.SimpleAction({
		name: "add-addon",
	});

	addAddon.connect("activate", () => {
		const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(add.substring(11)));
		// @ts-expect-error
		builder.set_current_object(builder.get_object("root", Adw.Dialog));
		/**
		 * @type {Adw.Window}
		 */
		// @ts-expect-error
		const view = builder.get_current_object(Adw.Dialog);
		const stack = (() => {
			const content = view.get_child();
			if (!(content instanceof Gtk.Stack)) throw new Error;
			return content;
		})();
		const content = (() => {
			const child = stack.get_child_by_name("content");
			if (!(child instanceof Embed)) throw new Error;
			return child;
		})();
		content.load(`<?xml version="1.0" encoding="UTF-8"?>
<interface>
  <requires lib="gtk" version="4.0"/>
  <object class="AdwPreferencesPage" id="root">
    <property name="icon-name">applications-system-symbolic</property>
    <property name="title" translatable="true">General</property>
    <child>
      <object class="AdwPreferencesGroup">
        <child>
          <object class="AdwActionRow" id="default_directory_row">
            <property name="title" translatable="true">Download Directory</property>
            <property name="subtitle">Select Location</property>
            <property name="activatable-widget">set_default_directory</property>
            <child type="suffix">
              <object class="GtkButton" id="set_default_directory">
                <property name="valign">3</property>
                <property name="halign">3</property>
                <property name="action-name">file.select-folder</property>
                <property name="action-target">("download-directory","")</property>
                <property name="icon-name">document-open-symbolic</property>
                <style>
                  <class name="flat"/>
                </style>
              </object>
            </child>
            <child type="suffix">
              <object class="GtkButton">
                <property name="valign">3</property>
                <property name="icon-name">user-trash-symbolic</property>
                <style>
                  <class name="flat"/>
                </style>
                <property name="action-name">file.set</property>
                <property name="action-target">("download-directory","")</property>
              </object>
            </child>
          </object>
        </child>
        <child>
          <object class="AdwActionRow">
            <property name="title" translatable="true">Playground</property>
            <property name="subtitle" translatable="true">Play with experimental UI components and APIs</property>
            <property name="action-name">preferences.show-playground</property>
          </object>
        </child>
      </object>
    </child>
  </object>
</interface>`, "console.log('Wow!');");

		stack.set_visible_child_name("content");
		// @ts-expect-error
		view.present(window);
	});

	workspaceActions.add_action(addAddon);

	const explore = new Gio.SimpleAction({
		name: "explore",
	});

	explore.connect("activate", nowait(async () => {
		if (_workspace === undefined) {
			console.warn("Cannot explore the root workspace folder when there is no workspace");
			return;
		}
		const { root } = _workspace;

		const launcher = Gtk.FileLauncher.new(root);

		await launcher.launch(window, null);
	}));

	workspaceActions.add_action(explore);

	const addWorkspace = new Gio.SimpleAction({
		name: "add",
	});

	addWorkspace.connect("activate", () => {
		folderStack.set_visible_child_name("pre-folder");
	});

	workspaceActions.add_action(addWorkspace);

	const restore = new Gio.SimpleAction({
		name: "restore",
	});

	restore.connect("activate", () => {
		const path = _recentWorkspaces[0];
		if (path === undefined) throw new Error;
		const file = Gio.File.new_for_path(makeCanonicalPath(path));
		updateWorkspace(folderStack, { setWorkspace })(file);
	});

	workspaceActions.add_action(restore);

	const reload = new Gio.SimpleAction({
		name: "reload",
	});

	reload.connect("activate", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;
		const { root } = _workspace;
		updateWorkspace(folderStack, { setWorkspace })(root);
	}));

	workspaceActions.add_action(reload);

	const exportList = new Gio.SimpleAction({
		name: "export",
	});

	exportList.connect("activate", logWhenCatch(() => {
		if (_workspace === undefined) throw new MissingWorkspace;
		const { root, entries } = _workspace;
		exportAsList(root, { entries }).catch(logError);
	}));

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
		updateWorkspace(folderStack, { setWorkspace })(file);
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
		if (_workspace === undefined) {
			console.warn("Cannot show details of an archive when there is no workspace that contains it");
			return;
		}
		const [val] = parameter.get_string();
		const entry = _workspace.entries.find(x => {
			return x.name === val;
		});
		if (entry === undefined) {
			console.warn("Cannot show detials of an archive that does not exist");
			return;
		}
		const { root } = _workspace;
		const builder = ExtendedBuilder(Gtk.Builder.new_from_resource(AddonDetails.substr(11)));
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
		useFile(addonDetailsWindow, builder, window);
		addonDetailsWindow.set_transient_for(window);
		addonDetailsWindow.title_widget.set_title(entry.name);

		const launchButton = builder.get_object("launch-button", Gtk.Button);
		launchButton.connect_after("clicked", () => {
			addonDetailsWindow.close();
		});

		const createButton = builder.get_object("create_button", Gtk.Button);

		const manifestButtonStack = builder.get_object("manifest_button_stack", Gtk.Stack);

		let useCreateButtonClicked = NaN;
		const manifest = root.get_child(`${entry.name}.toml`);
		const cancellable = new Gio.Cancellable;
		const monitor = manifest.monitor_file(Gio.FileMonitorFlags.NONE, cancellable);
		const useMonitorManifest = monitor.connect("changed", syncCreate((_, file, ___, ____) => {
			if (file.query_exists(cancellable)) {
				const path = manifest.get_path();
				if (path === null) return;
				launchButton.set_action_target_value(GLib.Variant.new_tuple([GLib.Variant.new_string(path)]));
				manifestButtonStack.set_visible_child_name("launch");
			} else {
				if (!isNaN(useCreateButtonClicked)) createButton.disconnect(useCreateButtonClicked);
				useCreateButtonClicked = createButton.connect("clicked", () => {
					(async () => {
						await manifest.replace_contents_async(defaultEncoder.encode(""), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
					})().catch(logError);
				});

				manifestButtonStack.set_visible_child_name("create");
			}
		}, null, manifest));

		(() => {
		})();
		const useWindowCloseRequest = (/** @type {Gtk.Window} */(addonDetailsWindow)).connect("close-request", (obj) => {
			cancellable.cancel();
			obj.disconnect(useWindowCloseRequest);
			monitor.disconnect(useMonitorManifest);
		});
		addonDetailsWindow.present();
	});

	workspaceActions.add_action(showDetails);

	window.insert_action_group("workspace", workspaceActions);

	application.set_accels_for_action("workspace.add", ["<Primary>O"]);

	const ScreenSizeViewstack = builder.get_object("screen_size_viewstack", Gtk.Stack);

	const headerboxActions = new Gio.SimpleActionGroup();

	const headerbox_reveal = Object.assign(new Gio.SimpleAction({
		name: "reveal",
	}), {
		nextReveal: false,
		stoboNextReveal: false,
	});

	headerbox_reveal.connect("activate", (_action) => {
		if (ScreenSizeViewstack.get_visible_child_name() === "roboken") {
			headerbox_reveal.nextReveal = !headerbox_reveal.nextReveal;
			if (headerbox_reveal.nextReveal) {
				headerbox.revealChild();
				profileBar.primaryButton.set_active(true);
			} else {
				headerbox.unrevealChild();
				profileBar.primaryButton.set_active(false);
			}
		} else {
			headerbox_reveal.stoboNextReveal = !headerbox_reveal.stoboNextReveal;
			if (headerbox_reveal.stoboNextReveal) {
				stoboProfile.set_reveal(true);
			} else {
				stoboProfile.set_reveal(false);
			}
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

	let useFlashTimeout = new Gio.Cancellable;

	const stoboHeaderbar = Object.assign(builder.get_object("stobo_headerbar", Adw.HeaderBar), {
		flashes: async () => {
			if (!useFlashTimeout.is_cancelled())
				useFlashTimeout.cancel();
			useFlashTimeout = new Gio.Cancellable();
			stoboHeaderbar.add_css_class("element");
			await delayMs(3000, useFlashTimeout).catch(error => {
				logError(error);
				return error;
			}).finally(() => {
				stoboHeaderbar.remove_css_class("element");
			});
		},
	});

	inject.connect("activate", nowait(async () => {
		if (_workspace === undefined) throw new MissingWorkspace;

		const { root, entries, shuffleChoices: previousShuffleChoices, requestSaveShuffleChoices, setLastBuild } = _workspace;

		const cancellable = new Gio.Cancellable;
		await cleanup(cancellable);
		const { files: archives, shuffleChoices } = filter(entries, previousShuffleChoices);
		requestSaveShuffleChoices(shuffleChoices);
		await link(root, archives, {
			addLine(line) {
				console.debug("linking-log:", line);
			}
		}, cancellable);
		setLastBuild(new Date);
		profileBar.toast("LJWsdf");
		stoboProfileBar.toast("LJWsdf");
	}));

	injectActions.add_action(inject);

	window.insert_action_group("inject", injectActions);

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

const bookmark = new Gio.SimpleAction({
	name: "bookmark",
	parameterType: GLib.VariantType.new("s"),
});

bookmark.connect("activate", (_action, parameter) => {
	if (parameter === null) throw new Error;
	const [val] = parameter.get_string();
	switch (val) {
	case "boki":
		// @ts-expect-error
		Gio.DBus.session.call(
			"com.github.kinten108101.Boki",
			"/com/github/kinten108101/Boki",
			"org.freedesktop.Application",
			"Activate",
			GLib.Variant.new_tuple([GLib.Variant.new_array(GLib.VariantType.new_dict_entry(GLib.VariantType.new("s"), GLib.VariantType.new("v")), [])]),
			null,
			Gio.DBusCallFlags.NONE,
			9000,
			null
		// @ts-expect-error
		).catch(logError);
		break;
	default:
		throw new Error(`Received \"${val}\"`);
	}
});

application.add_action(bookmark);

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
