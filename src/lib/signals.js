/**
 * The signal methods interface is not always part of the overall object interface. For example, an object may be created through the compositional pattern or the function-based constructor pattern, and signal methods are accessible through a child object e.g. `obj._signals.connect` instead of `obj.connect`. However, sometimes you may want to merge these signal methods into the overall object interface, for ease of access e.g. you want to use `obj.connect`. Perhaps these signal methods are only merged into the *public* object interface. In this case, this function achieves that by forwarding signal methods from `obj` to `obj._signals`.
 * @template {import("@girs/gjs").SignalMethods} K
 * @param {K} signal_methods
 */
export const forwardSignalMethods = (signal_methods) => {
	/**
	 * @template {object} T
	 * @param {T} iface
	 * @returns {T & K}
	 */
	return (iface) => {
		// @ts-expect-error
		return new Proxy(iface, {
			get(target, property_name, receiver) {
				if (typeof property_name === 'string' && [
					'connect',
					'disconnect',
					'disconnectAll',
					'emit',
					'signalHandlerIsConnected',
				].includes(property_name) /** What about in keyword? */) {
					return Reflect.get(signal_methods, property_name, receiver).bind(signal_methods);
				}
				const ret = Reflect.get(target, property_name, receiver);
				// TODO(kinten): Check call signature?
				if (typeof ret === "object" && ret !== null && "bind" in ret && typeof ret.bind === "object" && ret.bind !== null && "apply" in ret.bind) ret.bind?.(target);
				return ret;
			}
		});
	};
};

/**
 * @template {{}} T
 *
 * @param {T=} obj
 * @returns {import("@girs/gjs").SignalMethods & T}
 */
export const addSignalMethods = (obj) => {
	const _obj = obj || {};
	imports.signals.addSignalMethods(_obj);
	// @ts-expect-error
	return _obj;
};
