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

/**
 * @template {any[]} K
 * @template {(...args: K) => void} T
 * @param {T} cb
 */
export const logWhenCatch = (cb) => {
	/**
	 * @param {K} args
	 */
	return (...args) => {
		try {
			return cb(...args);
		} catch (error) {
			logError(error);
		}
	};
};
