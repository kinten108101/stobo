import GObject from "gi://GObject";

import { syncCreate } from "./functional.js";

/**
 * @typedef {(signal: string, cb: (...args: any[]) => void) => number} ConnectMethod
 * @typedef {(id: number) => void} DisconnectMethod
 * @typedef {{ connect: ConnectMethod; disconnect: DisconnectMethod; }} Connectable
 * @typedef {{ [key: string]: any }} AccessibleProperties
 */

/**
 * @param {number} charcode
 * @param {string} name
 */
function caseX2Camel(charcode, name) {
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
				return null;
			}
		}

		if (code !== charcode && (code < 97 || code > 122)) {
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

			if (x === charcode && nextX >= 97 && nextX <= 122) {
				newU8Array.push(nextX - 32);
				return 2;
			}

			newU8Array.push(x);
			return 1;
		})();

		i+=step;
	}

	return newU8Array.map(x => String.fromCharCode(x)).reduce((acc, x) => acc.concat(x), "");
}

const caseBurger2Camel = caseX2Camel.bind(null, 45);

/**
 * @param {Connectable & AccessibleProperties} src
 * @param {string} srcProp
 * @param {Connectable & AccessibleProperties} target
 * @param {string} targetProp
 * @param {GObject.BindingFlags} flags
 * @param {(binding: GObject.Binding | null, from: any) => [boolean, any]} transformerFrom
 * @param {((binding: GObject.Binding| null, to: any) => [boolean, any]) | null} transformerTo
 */
export const bind_property_full = (src, srcProp, target, targetProp, flags, transformerFrom, transformerTo) => {
	const jsSrcProp = caseBurger2Camel(srcProp);
	if (jsSrcProp === null) throw new Error;
	const jsTargetProp = caseBurger2Camel(targetProp);
	if (jsTargetProp === null) throw new Error;
	/** @type {GObject.Binding=} */
	let binding = undefined;
	// @ts-expect-error
	const _syncCreate = (flags & GObject.BindingFlags.SYNC_CREATE) > 0 ? syncCreate : (x) => x;

	const use_src = src.connect(`notify::${srcProp}`, _syncCreate(() => {
		const oldVal = src[jsSrcProp];
		const [ shouldContinue, newVal ] = transformerFrom(binding || null, oldVal);
		if (shouldContinue) {
			target[jsTargetProp] = newVal;
		}
	}));

	const use_target = (() => {
		if ((flags & GObject.BindingFlags.BIDIRECTIONAL) > 0) {
			return target.connect(`notify::${targetProp}`, _syncCreate(() => {
				const oldVal = target[jsTargetProp];
				const _transformerTo = transformerTo ?
					transformerTo :
					/**
					 * @param {any} _
					 * @param {any} to
					 */
					(_, to) => [true, to];
				const [ shouldContinue, newVal ] = _transformerTo(binding || null, oldVal);
				if (shouldContinue) {
					src[jsSrcProp] = newVal;
				}
			}));
		} else return null;
	})();

	binding = (/** @type GObject.Binding */ (/** @type unknown */ ({
		flags,
		unbind() {
			src.disconnect(use_src);
			if (use_target) target.disconnect(use_target);
		}
	})));

	return binding;
};

/**
 * @param {Connectable} src
 * @param {string} srcProp
 * @param {Connectable} target
 * @param {string} targetProp
 * @param {GObject.BindingFlags} flags
 */
export const bind_property = (src, srcProp, target, targetProp, flags) => {
	return bind_property_full(src, srcProp, target, targetProp, flags,
		(_, from) => [true, from],
		(_, to) => [true, to],
	);
};
