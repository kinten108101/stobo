import Gtk from 'gi://Gtk';

/**
 * @typedef {import('@girs/gobject-2.0').default} GObject
 */

/**
 * @typedef {<T extends Function>(name: string, klass: T) => T['prototype']} NewGetObject
 */

/**
 * @typedef {<T extends Function>(klass: T) => T['prototype']} NewGetCurrentObject
 */

/**
 * A null-safe implementation (wrapper) of {@link Gtk.Builder}.
 *
 * @param {Gtk.Builder} builder
 * @returns {{
 * get_object: NewGetObject;
 * get_current_object: NewGetCurrentObject;
 * } & Gtk.Builder}
 */
const ExtendedBuilder = (builder) => {
	/**
	 * @type {NewGetObject}
	 */
	const get_object = (name, klass) => {
		const obj = builder.get_object(name);
		if (obj === null) throw new Error(`Builder could not retrieve object named \"${name}\" in ui file.`);
		if (!(obj instanceof klass)) throw new Error(`Builder found that object named \"${name}\" is not of type ${klass.name}.`);
		return obj;
	}

	/**
	 * @param {any[]} args
	 */
	const get_object_resolver = (...args) => {
		if (args.length === 2) return get_object.bind(null, ...args)();
		else if (args.length === 1) return builder.get_object.bind(builder, ...args)();
		else throw new Error;
	};

	/**
	 * @type {NewGetCurrentObject}
	 */
	const get_current_object = (klass) => {
		const obj = builder.get_current_object();
		if (obj === null) throw new Error(`Builder could not retrieve current object, possibly not set.`);
		if (!(obj instanceof klass)) throw new Error(`Builder found that current object is not of type ${klass.name}.`);
		return obj;
	};

	return new Proxy(builder, {
		get(obj, property_name, receiver) {
			if (property_name === 'get_object') {
				return get_object_resolver;
			} else if (property_name === 'get_current_object') {
				return get_current_object.bind(builder);
			}
			const val = Reflect.get(obj, property_name, receiver);
			if ("apply" in val) return val.bind(obj);
			return val;
		}
	});
};

export default ExtendedBuilder;
