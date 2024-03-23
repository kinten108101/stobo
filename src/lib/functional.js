/**
 * Callback will be executed as IIFE and will return itself so as to be used later.
 *
 * @template {any[]} ArgTypes
 * @param {(...params: ArgTypes) => void} cb
 * @param {ArgTypes} args
 */
export const syncCreate = (cb, ...args) => {
	cb(...args);
	return cb;
};
