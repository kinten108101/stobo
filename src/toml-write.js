import Gio from "gi://Gio";
import GLib from "gi://GLib";

const defaultEncoder = new TextEncoder();

/**
 * @param {{ [key: string]: any }} value
 */
const JsDict2Toml = (value) => {
	return Object.keys(value).reduce((acc, key) => {
		const x = value[key];
		const tomlX = (() => {
			if (typeof x === "number") return String(x);
			else return `"${x}"`;
		})();
		return `${acc}\n${key} = ${tomlX}`;
	}, "");
};

/**
 * @param {Gio.File} source
 * @param {{ [key: string]: any }} value
 * @param {Gio.Cancellable | null} cancellable
 */
export const tomlAppend = async (source, value, cancellable) => {
	const bytes = defaultEncoder.encode(JsDict2Toml(value));
	const outstream = await source.append_to_async(Gio.FileCreateFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
	const bytes_written = await outstream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancellable);
	return bytes_written;
};
