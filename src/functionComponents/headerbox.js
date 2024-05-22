import Gtk from "gi://Gtk";

import ExtendedBuilder from "../lib/builder.js";

const tabs = {
	status: {
		box: "status::default",
		panel: "default",
	},
	console: {
		box: "console::default",
		panel: "default",
	},
};

/**
 * @template {{ [key: string | symbol]: any }} T
 * @param {T} x
 */
function extend(x) {
	const newmethods = {
		/**
		 * @template K
		 * @param {(value: (typeof x)[keyof typeof x], key: keyof typeof x) => K} fn
		 */
		map(fn) {
			return extend(Object.keys(x).map(
				/**
				 * @param {keyof typeof x} key
				 */
				key => {
					const value = x[key];
					return { [key]: fn(value, key) };
				}
			).reduce((acc, x) => ({ ...acc, ...x }), {}));
		},
		/**
		 * @param {(value: (typeof x)[keyof typeof x], key: keyof typeof x) => void} fn
		 */
		forEach(fn) {
			Object.keys(x).forEach(
				/**
				 * @param {keyof typeof x} key
				 */
				key => {
					const value = x[key];
					fn(value, key);
				}
			);
		},
		/**
		 * @template {{ [key: string | symbol]: any }} B
		 * @template C
		 * @param {B} y
		 * @param {(a: (typeof x)[keyof typeof x], b: B[keyof B]) => C} method
		 */
		merge(y, method) {
			return extend(Object.keys(x).map(
				/**
				 * @param {keyof typeof x} key
				 */
				key => {
					const valuex = x[key];
					const valuey = y[key];
					const newvalue = method(valuex, valuey);
					return { [key]: newvalue };
				}
			).reduce((acc, x) => ({ ...acc, ...x }), {}));
		}
	};
	return new Proxy(/** @type {T & typeof newmethods} */(x), {
		get(target, p, receiver) {
			const replacement = newmethods[p];
			if (replacement === undefined) {
				return Reflect.get(target, p, receiver);
			} else return replacement;
		}
	});
}

/**
 * @template {{}} A
 * @param {A} val
 */
function makeMethods(val) {
	return {
		/**
		 * @template B
		 * @param {(value: A) => B} transform
		 */
		then(transform) {
			const newval = transform(val);
			return makeMethods({
				...val,
				...newval
			});
		},
		/**
		 * @template {{}} B
		 * @param {(value: A) => B} transform
		 */
		culminates(transform) {
			const newval = transform(val);
			return newval;
		}
	};
}

/**
 * @param {ReturnType<typeof ExtendedBuilder>} builder
 */
export const useHeaderbox = builder => makeMethods({
	headerboxRevealer: builder.get_object("headerbox_revealer", Gtk.Revealer),
	contentRevealer: builder.get_object("content_revealer", Gtk.Revealer),
	isEmpty: extend(tabs).map(_ => false),
	states: { childRevealed: false },
}).then(({
	isEmpty,
}) => {
	const tabButtons = extend(tabs).map((_, key) => builder.get_object(`button_${key}`, Gtk.ToggleButton));

	return {
		/**
		 * @param {string} name
		 */
		updateBoxStack(name) {
			extend(tabs).forEach((_, key) => {
				const currentButton = tabButtons[key];
				if (currentButton === undefined) throw new Error;
				currentButton.set_active(key === name);

				const empty = isEmpty[key];
				if (empty === undefined) throw new Error;
				if (empty) {
					contentTypeStack.set_visible_child_name("empty_content");
					panelControls.set_visible_child_name("default");
				} else {
					contentTypeStack.set_visible_child_name("default_content");
					boxStack.set_visible_child_name(page.box);
					panelControls.set_visible_child_name(page.panel);
				}
			});
		},
	};
}).then(({
	headerboxRevealer,
	contentRevealer,
	states
}) => {
	headerboxRevealer.connect("notify::child-revealed", () => {
		if (!headerboxRevealer.get_child_revealed()) {
			states.childRevealed = false;
			return;
		}
		contentRevealer.set_reveal_child(true);
    });

	contentRevealer.connect("notify::child-revealed", () => {
		if (contentRevealer.get_child_revealed()) {
			states.childRevealed = true;
			return;
		}
		headerboxRevealer.set_reveal_child(false);
	});
}).culminates(({
	headerboxRevealer,
	contentRevealer,
	states,
	updateBoxStack,
}) => ({
	reveal() {
		headerboxRevealer.set_reveal_child(true);
        if (states.childRevealed) {
			contentRevealer.set_reveal_child(true);
			headerboxRevealer.set_reveal_child(true);
        }
	},
	collapse() {
		contentRevealer.set_reveal_child(false);
		if (!states.childRevealed) {
			contentRevealer.set_reveal_child(false);
			headerboxRevealer.set_reveal_child(false);
		}
	},
	/**
	 * @param {string} name
	 */
	switchTo(name) {
		if (!(name in tabs)) throw new Error;
		updateBoxStack(name);
	}
}));
