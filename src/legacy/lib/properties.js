import { bind_property_full } from "./bind.js";

/**
 * @param {number} charcode
 * @param {string} name
 */
function caseCamel2X(charcode, name) {
	const charArray = Array.from(name);

	/**
	 * @type number[]
	 */
	const u8Array = [];

	for (const key in charArray) {
		const i = Number(key);
		const x = charArray[i];
		if (x === undefined) continue;

		const code = x.charCodeAt(0);

		if (i === 0) {
			if (!(code >= 97 && code <= 122)) {
				console.debug(`caseCamel2X: refused to converted text \"${name}\" because first character is not lowercase`);
				return null;
			}
		}

		if (code < 65 || (code > 90 && code < 97) || code > 122) {
			console.debug(`caseCamel2X: refused to converted text \"${name}\" because a character is not in the alphabet`);
			return null;
		}
		u8Array.push(code);
	}

	/**
	 * @type number[]
	 */
	const newU8Array = [];

	let i = 0;
	while (i < u8Array.length) {
		const x = u8Array[i];

		const step = (() => {
			if (x === undefined) return 1;

			if (i === u8Array.length - 1) {
				newU8Array.push(x);
				return 1;
			}

			const nextX = u8Array[i + 1];

			if (nextX === undefined) return 1;

			if (x >= 97 && x <= 122 && nextX >= 65 && nextX <= 90) {
				newU8Array.push(x, charcode, nextX + 32);
				return 2;
			}

			newU8Array.push(x);
			return 1;
		})();

		i+=step;
	}

	return newU8Array.map(x => String.fromCharCode(x)).reduce((acc, x) => acc.concat(x), "").toLowerCase();
}

const caseCamel2Burger = caseCamel2X.bind(null, 45);

/**
 * @template {import("@girs/gjs").SignalMethods} SignalMethods
 * @template {object} Properties
 *
 * @param {Properties} properties
 * @param {SignalMethods} events
 */
export const addProperties = (properties, events) => {
	const _bind_property_full = bind_property_full.bind(null, forwardProperties(properties)(events));

	const iface = (/** @type {{ bind_property_full: typeof _bind_property_full } & Properties} */(/** @type unknown */(new Proxy(properties, {
		get(target, p) {
			if (p === "bind_property_full") {
				return _bind_property_full;
			}
			return target[p];
		},
		set(target, p, newValue, receiver) {
			if (typeof p !== "string") return false;
			const oldValue = Reflect.get(target, p, receiver);
			if (typeof oldValue !== typeof newValue) return false;
			target[p] = newValue;
			const signalNameRightPart = caseCamel2Burger(p);
			if (signalNameRightPart === null) return false;
			const signalName = `notify::${signalNameRightPart}`;
			events.emit(signalName);
			return true;
		}
	}))));

	return iface;
};

/**
 * @template {object} Properties
 * @param {Properties} properties
 */
export function forwardProperties(properties) {
	/**
	 * @template {object} T
	 * @param {T} iface
	 * @returns {Properties & T}
	 */
	return (iface) => {
		// @ts-expect-error
		return new Proxy(iface, {
			get(target, p, receiver) {
				if (p in properties) {
					return Reflect.get(properties, p, receiver);
				}
				return Reflect.get(target, p, receiver);
			},
			set(target, p, newValue, receiver) {
				if (p in properties) {
					Reflect.set(properties, p, newValue, receiver);
				} else {
					Reflect.set(target, p, newValue, receiver);
				}
				return true;
			}
		});
	};
}
