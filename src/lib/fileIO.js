import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const defaultDecoder = new TextDecoder('utf8');
export const defaultEncoder = new TextEncoder();

/**
 * @param {Gio.File} file
 */
export function isDir(file) {
	const info = file.query_info(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, Gio.FileQueryInfoFlags.NONE, null);
	const type = info.get_file_type();
	if (type !== Gio.FileType.DIRECTORY) {
		return false;
	}
	return true;
}

/**
 * @param {Gio.File} file
 */
export async function isDirAsync(file) {
	const info = await file.query_info_async(Gio.FILE_ATTRIBUTE_FILESYSTEM_TYPE, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
	const type = info.get_file_type();
	if (type !== Gio.FileType.DIRECTORY) {
		return false;
	}
	return true;
}

/**
 * @param {Gio.File} dir
 */
export function listFile(dir) {
	/** @type Gio.File[] */ const files = [];
	const iter = dir.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, null);
	/** @type Gio.FileInfo? */ let info;
	do {
		info = iter.next_file(null);
		if (info !== null) {
			const name = info.get_name();
			files.push(dir.get_child(name));
		}
	} while (info !== null);
	return files;
}

/**
 * @param {Gio.File} dir
 */
export async function listFileAsync(dir) {
	/** @type Gio.File[] */ const files = [];
	const iter = await dir.enumerate_children_async(Gio.FILE_ATTRIBUTE_STANDARD_NAME, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
	/** @type Gio.FileInfo? */ let info;
	do {
		info = iter.next_file(null);
		if (info !== null) {
			const name = info.get_name();
			files.push(dir.get_child(name));
		}
	} while (info !== null);
	return files;
}

/**
 * @param {Gio.File} dir
 */
export function makeDirNonstrict(dir) {
	try {
		dir.make_directory(null);
	} catch (error) {
		if (error instanceof GLib.Error) {
			if (error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS)) {}
			else throw error;
		} else throw error;
	}
}

/**
 * @param {Gio.File} dir
 */
export async function makeDirNonstrictAsync(dir) {
	try {
		await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
	} catch (error) {
		if (error instanceof GLib.Error) {
			if (error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS)) {}
			else throw error;
		} else throw error;
	}
}

/**
 * @param {Gio.File} file
 */
export function readJson(file) {
	const [, bytes,] = file.load_contents(null);
	const serial = defaultDecoder.decode(bytes);
	const jsObject = JSON.parse(serial);
	return jsObject;
}

/**
 * @param {Gio.File} file
 */
export async function readJsonAsync(file) {
	const [bytes,] = await file.load_contents_async(null);
	const serial = defaultDecoder.decode(bytes);
	const jsObject = JSON.parse(serial);
	return jsObject;
}

/**
 * @param {Uint8Array} bytes
 */
export function readJsonBytes(bytes) {
	const serial = defaultDecoder.decode(bytes);
	const jsObject = JSON.parse(serial);
	return jsObject;
}

/**
 * @param {any} value
 * @param {Gio.File} dest
 */
export function replaceJson(value, dest) {
	const serial = serialize(value);
	const bytes = defaultEncoder.encode(serial);
	dest.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
	return;
}

/**
 * @param {any} value
 * @param {Gio.File} dest
 */
export async function replaceJsonAsync(value, dest) {
	const serial = serialize(value);
	const bytes = defaultEncoder.encode(serial);
	dest.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.NONE, null);
	return;
}

/**
 * @param {any} value
 */
function serialize(value) {
	return JSON.stringify(value, null, 2);
}

/**
 * @param {any} value
 * @param {Gio.File} dest
 */
export function createJson(value, dest) {
	const serial = serialize(value);
	const bytes = defaultEncoder.encode(serial);
	if (dest.query_exists(null)) throw new GLib.Error(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS, 'JSON file already exists');
	dest.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
	return;
}

/**
 * @param {any} value
 * @param {Gio.File} dest
 */
export async function createJsonAsync(value, dest) {
	const serial = serialize(value);
	const bytes = defaultEncoder.encode(serial);
	if (dest.query_exists(null)) throw new GLib.Error(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS, 'JSON file already exists');
	dest.replace_contents_async(bytes, null, false, Gio.FileCreateFlags.NONE, null);
	return;
}
