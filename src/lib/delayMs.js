import Gio from "gi://Gio";
const Cancelable = Gio.Cancellable;

/**
 * @param {number} durationMs
 * @param {typeof Cancelable.prototype=} cancellable
 */
const delayMs = async (durationMs, cancellable) => {
	return new Promise((resolve) => {
		let handleCancel = NaN;
		const handleTimeout = setTimeout(() => {
			if (!isNaN(handleCancel)) {
				cancellable?.disconnect(handleCancel);
			}
			resolve(true);
		}, durationMs);
		handleCancel = cancellable?.connect(() => {
			console.debug("Delay cancelled");
			clearTimeout(handleTimeout);
			resolve(false);
		}) || NaN;
	});
};

export default delayMs;
