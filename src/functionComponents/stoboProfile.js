import Gtk from "gi://Gtk";

/**
 * @param {ReturnType<typeof import("./profileBar.js").default>} profileBar
 */
const StoboProfile = (profileBar) => {
	const popover = new Gtk.Popover();
	popover.set_parent(profileBar.primaryButton);

	/**
	 * @type {(() => void)[]}
	 */
	const callbacksPopoverClosed = [];

	popover.connect("notify::visible", () => {
		if (!popover.visible) callbacksPopoverClosed.forEach(x => x());
	});

	return {
		/**
		 * @param {boolean} val
		 */
		set_reveal(val) {
			if (val) {
				profileBar.primaryButton.set_active(true);
				popover.set_visible(true);
			} else {
				profileBar.primaryButton.set_active(false);
				popover.set_visible(false);
			}
		},
		/**
		 * @param {() => void} callback
		 */
		onPopoverClosed(callback) {
			callbacksPopoverClosed.push(callback);
		}
	}
};

export default StoboProfile;
