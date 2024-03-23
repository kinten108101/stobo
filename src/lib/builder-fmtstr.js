import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

/**
 * @template {any} T
 * @param {string} formatting_string
 * @param {Gtk.Builder} builder
 */
export const get_value_from_formatting_string = (formatting_string, builder) => {
	if (formatting_string.length > 2 && formatting_string[0] == '{' && formatting_string[formatting_string.length - 1] == '}') {
		if (!builder) throw new Error;
		const path = formatting_string.substring(1, formatting_string.length - 1);
		const segments = path.split('.');
		if (segments.length < 2) throw new Error;
		const obj_name = (/** @type {string} */(segments[0]));
		console.debug('obj_name', obj_name);
		const obj = builder.get_object(obj_name);
		if (!obj) throw new Error;
		/** @type {any} */
		let val = obj;
		for (let i = 1; i < segments.length; i++) {
			const key = (/** @type {string} */(segments[i]));
			console.debug('key', i, key);
			val = val[key];
		}
		return /** @type {T} */(val);
	}
	return null;
}

/**
 * @template {GObject.Object} T
 * @param {string} formatting_string
 * @param {Gtk.Builder} builder
 */
export const get_object_from_formatting_string = (formatting_string, builder) => {
	if (formatting_string.length > 2 && formatting_string[0] == '{' && formatting_string[formatting_string.length - 1] == '}') {
		const obj_name = formatting_string.substring(1, formatting_string.length - 1);
		return /** @type {T | null} */(builder.get_object(obj_name));
	}
	return null;
}
