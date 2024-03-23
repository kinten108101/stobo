import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import { addSignalMethods, forwardSignalMethods } from "./lib/signals.js";
import { bind_property, bind_property_full } from "./lib/bind.js";
import { addProperties, forwardProperties } from "./lib/properties.js";
import { IS_STATUS_KLASS, Status, ErrorStatus, topFactory as statusFactory, BuildStatus } from "../services/status.js";
import * as StatusExports from "../services/status.js";

/**
 * @typedef {(signal: string, cb: (...args: any[]) => void) => number} ConnectMethod
 * @typedef {(id: number) => void} DisconnectMethod
 * @typedef {{ connect: ConnectMethod; disconnect: DisconnectMethod; }} Connectable
 * @typedef {{
 *  	disconnect(id: number): void;
 *      disconnectAll(): void;
 *      signalHandlerIsConnected(id: number): boolean;
 * }} SharedSignalMethods
 */

/**
 * @template {string} SignalName
 * @template {any[]} HandlerArgs
 *
 * @typedef {{
 * 		connect: {
 * 			(signal: SignalName, cb: ($obj: unknown, ...args: HandlerArgs) => void): number;
 * 		},
 *      emit: {
 *          (signal: SignalName, ...args: HandlerArgs): void;
 *      },
 * }} Signal
 */

class BoxPage extends GObject.Object {
	static {
		GObject.registerClass({
			Properties: {
				button: GObject.ParamSpec.object(
					"button", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					Gtk.ToggleButton.$gtype),
				empty: GObject.ParamSpec.boolean(
					"empty", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					true),
				box: GObject.ParamSpec.string(
					"box", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
				panel: GObject.ParamSpec.string(
					"panel", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
			},
		}, this);
	}

	/**
	 * @param {boolean} val
	 */
	set_empty(val) {
		if (val === this.empty) return;
		this.empty = val;
	}

	/**
	 * @param {{
	 * button: Gtk.ToggleButton;
	 * box: "status::default" | "status::build" | "console::default";
	 * panel: "status::clear" | "default";
     * }} params
	 */
	constructor(params) {
		super(params);
		this.button = params.button;
		this.box = params.box;
		this.panel = params.panel;
		this.empty = true;
	}
}

/**
 * @param {ReturnType<typeof import("./lib/builder").default>} builder
 */
const BuildBox = (builder) => {
	const titleLabel = builder.get_object("title_label", Gtk.Label);
	const timeElapsedField = builder.get_object("time_elapsed_field", Gtk.Label);
	const statusField = builder.get_object("status_field", Gtk.Label);

	/**
	 * @type {(time: number) => [boolean, number]}
	 */
	let _shouldUpdate = (time) => [true, time];

	/**
	 * @type {{}
	 * & Signal<"notify::title-type", []>
	 * & Signal<"notify::elapsed", []>
	 * & Signal<"notify::elapsed-display-mode", []>
	 * & Signal<"notify::status", []>
	 * & Signal<"notify::time-unit-word", []>
	 * & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	const properties = addProperties({
		titleType: (/** @type {"in-progress" | "done"} */ ("in-progress")),
		elapsedDisplayMode: (/** @type {"free" | "fixed"} */ ("free")),
		status: "",
		timeUnitWord: (/** @type {"s" | "ms"} */ ("s")),
	}, events);

	properties.bind_property_full("title-type", titleLabel, "label",
		GObject.BindingFlags.SYNC_CREATE,
		/**
		 * @param {unknown} _binding
		 * @param {typeof properties.titleType | null} from
		 */
		(_binding, from) => {
			if (from === null) return [false, ""];
			switch (from) {
			case "in-progress":
				return [true, "Injection in Progress"];
			case "done":
				return [true, "Injection Completed"];
			default:
				throw new Error(`Unknown title type. Received \"${from}\"`);
			}
		}, null);

	/**
	 * @param {number} timeMs
	 */
	const makeTimeDisplayable = (timeMs) => {
		switch (properties.elapsedDisplayMode) {
		case "free":
			return `${String(timeMs)}${properties.timeUnitWord}`;
		case "fixed":
			throw new Error("Not implemented");
		default:
			throw new Error;
		}
	};

	properties.bind_property_full("elapsed", timeElapsedField, "label",
		GObject.BindingFlags.SYNC_CREATE,
		/**
		 * @param {number | null} from
		 * @returns {[boolean, string]}
		 */
		(_binding, from) => {
			if (from === null)
				return [false, ""];
			const [ready_update, val] = _shouldUpdate(from);
			if (!ready_update)
				return [false, ""];
			return [true, makeTimeDisplayable(val)];
		}, null);

	const updateTimeUnit = () => {
		switch (properties.timeUnitWord) {
		case "ms":
			_shouldUpdate = (time) => [true, time];
			break;
		case "s":
			_shouldUpdate = (time) => {
			if (time % 1000 !== 0) return [false, 0];
				return [true, time / 1000];
			};
			break;
		default:
			throw new Error;
		}
	};

	events.connect("notify::time-unit-word", updateTimeUnit);

	updateTimeUnit();

	properties.bind_property_full("status", statusField, "label",
		GObject.BindingFlags.SYNC_CREATE,
		/**
		 * @param {string | null} from
		 */
		(_binding, from) => {
		if (from === null) return [true, ""];
			return [true, from];
		}, null);

	return forwardProperties(properties)(forwardSignalMethods(events)({}));
};

/**
 * @param {ReturnType<typeof import("./lib/builder").default>} builder
 */
const ConsoleBox = (builder) => {
	const output = builder.get_object("output", Gtk.Label);

	/**
	 * @type {{}
	 * & Signal<"lines-changed", []>
	 * & Signal<"notify::text-empty", []>
	 * & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	const _properties = {
		textEmpty: false,
	};

	const properties = addProperties(_properties, events);

	/**
	 * @type string[]
	 */
	let lines = [];

	/**
	 * @param {boolean} val
	 */
	const _setTextEmpty = (val) => {
		if (_properties.textEmpty === val) return;
		_properties.textEmpty = val;
		events.emit("notify::text-empty");
	}

	const renderLines = () => {
		const text = lines.reduce((acc, val, i) => {
		if (i === 0) return `${val}`;
			return `${acc}\n${val}`;
		}, "");
		if (text === "") {
			_setTextEmpty(true);
		} else {
			_setTextEmpty(false);
		}
		output.set_label(text);
	};

	events.connect("lines-changed", renderLines);

	const cleanOutput = () => {
		lines = [];
		events.emit("lines-changed");
	};

	/**
	 * @param {string} line
	 */
	const addLine = (line) => {
		lines.push(line);
		events.emit("lines-changed");
	}

	const reset = () => {
		cleanOutput();
	};

	return forwardProperties(properties)(forwardSignalMethods(events)({
		addLine,
		reset
	}));
};

/**
 * @param {ReturnType<typeof import("./lib/builder").default>} builder
 *
 * @deprecated
 */
const HeaderBox = (builder) => {
	const headerboxRevealer = builder.get_object("headerbox_revealer", Gtk.Revealer);
	const contentRevealer = builder.get_object("content_revealer", Gtk.Revealer);
	const frameStack = builder.get_object("frame_stack", Adw.ViewStack);
	const contentTypeStack = builder.get_object("content_type_stack", Adw.ViewStack);
	const buttonStatus = builder.get_object("button_status", Gtk.ToggleButton);
	const buttonConsole = builder.get_object("button_status", Gtk.ToggleButton);
	const boxStack = builder.get_object("box_stack", Adw.ViewStack);
	const panelControls = builder.get_object("panel_controls", Adw.ViewStack);
	const detachable = builder.get_object("detachable", Adw.Window);
	const statusBox = builder.get_object("status_box", Gtk.Box);
	const statusTitle = builder.get_object("status_title", Gtk.Label);
	const statusDescription = builder.get_object("status_description", Gtk.Label);
	const addonCountLabel = builder.get_object("addon_count_label", Gtk.Label);
	const headerboxProfileLabel = builder.get_object("headerbox_profile_label", Gtk.Label);

	const buildBox = BuildBox(builder);

	const consoleBox = ConsoleBox(builder);

	/**
	 * @type {{}
	 * & Signal<"childRevealed", [boolean]>
	 * & Signal<"currentPage", []>
	 * & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	/**
	 * @type {keyof pages}
	 */
	let currentPage = "status_box";

	/**
	 * @param {keyof pages} val
	 */
	const setCurrentPage = (val) => {
		currentPage = val;
		events.emit("currentPage");
	};

	/**
	 * @type boolean
	 */
	let childRevealed = false;

	/**
	 * @param {boolean} val
	 */
	const setChildRevealed = (val) => {
		childRevealed = val;
		events.emit("childRevealed", childRevealed);
	};

	const updateBoxStack = () => {
		const page = pages[currentPage];
		if (page === undefined) throw new Error;
		const { empty } = page;
		if (empty) {
			contentTypeStack.set_visible_child_name("empty_content");
			panelControls.set_visible_child_name("default");
		} else {
			contentTypeStack.set_visible_child_name("default_content");
			boxStack.set_visible_child_name(page.box);
			panelControls.set_visible_child_name(page.panel);
		}

		Object.keys(pages).forEach((key) => {
			const x = (/** @type {{[key: string]: BoxPage}} */ (/** @type unknown */(pages)))[key];
			if (x === undefined) return;
			const { button } = x;
			if (key !== currentPage) {
				button.set_active(false);
				return;
			}
			button.set_active(true);
		});
	}

    events.connect("currentPage", updateBoxStack);

	const pages = {
		status_box: (() => {
			const page = new BoxPage({
				button: buttonStatus,
				box: "status::default",
				panel: "default",
			});

			page.connect("notify::box", updateBoxStack);
			page.connect("notify::panel", updateBoxStack);
			page.connect("notify::empty", updateBoxStack);

			return page;
		})(),
		console_box: (() => {
			const page = new BoxPage({
				button: buttonConsole,
				box: "console::default",
				panel: "default",
			});

			page.connect("notify::box", updateBoxStack);
			page.connect("notify::panel", updateBoxStack);
			page.connect("notify::empty", updateBoxStack);

			return page;
		})(),
	};

	const revealChild = () => {
		headerboxRevealer.set_reveal_child(true);
        if (childRevealed) {
			contentRevealer.set_reveal_child(true);
			headerboxRevealer.set_reveal_child(true);
        }
    };

    const unrevealChild = () => {
    	contentRevealer.set_reveal_child(false);
		if (!childRevealed) {
			contentRevealer.set_reveal_child(false);
			headerboxRevealer.set_reveal_child(false);
		}
    };

    headerboxRevealer.connect("notify::child-revealed", () => {
		if (!headerboxRevealer.get_child_revealed()) {
			setChildRevealed(false);
			return;
		}
		contentRevealer.set_reveal_child(true);
    });

	contentRevealer.connect("notify::child-revealed", () => {
		if (contentRevealer.get_child_revealed()) {
			setChildRevealed(true);
			return;
		}
		headerboxRevealer.set_reveal_child(false);
	});

	detachable.connect("notify::visible", () => {
		if (detachable.get_visible()) {
			frameStack.set_visible_child_name("popped_view");
			return;
		}
		frameStack.set_visible_child_name("default_view");
    });

    const update_console_box_empty = () => {
      const page = pages.console_box;
      page.set_empty(consoleBox.textEmpty);
    };

    consoleBox.connect("notify::text-empty", update_console_box_empty);

    update_console_box_empty();

	/**
	 * @param {"error" | "generic" | "build"} type
	 * @param {(obj: unknown, ...args: any[]) => void} cb
	 */
	const bindStatus = (type, cb) => {
		const page = pages.status_box;
		if (type === "error" || type === "generic") {
			setStatusStyle(type);
			page.box = "status::default";
			cb(null, statusTitle, statusDescription);
		} else if (type === "build") {
			setStatusStyle("generic");
			page.box = "status::build";
			cb(null, buildBox);
		}
	};

	/**
	 * @param {"error" | "generic"} statusType
	 */
	const setStatusStyle = (statusType) => {
		const style_options = {
			red: "red",
			white: "white",
		};
		const iconname_options = {
			error: "error-symbolic",
			question_round: "question-round-symbolic",
		};
		/**
		 * @param {string[]} classes
		 * @param {string} style
		 */
		function pick(classes, style) {
			const css = new Set(classes);
			for (const x in style_options) {
				if ((/** @type {{ [key: string]: string }} */(style_options))[x] === style) {
					css.add(style);
					continue;
				}
				css.delete(x);
			}
			/**
			 * @param {Set<any>} set
			 */
			function set2arr(set) {
				/**
				 * @type any[]
				 */
				const arr = [];
				set.forEach(x => {
					arr.push(x);
				});
				return arr;
			}
			const _classes = set2arr(css);
			return _classes;
		}
		const [style, icon_name] = (() => {
			switch (statusType) {
			case "error":
				return [
					style_options.red,
					iconname_options.error,
				];
			case "generic":
				return [
					style_options.white,
					iconname_options.question_round,
				];
			}
		})();
		buttonStatus.set_css_classes(
			pick(buttonStatus.css_classes, style)
		);
		buttonStatus.set_icon_name(icon_name);
		statusBox.set_css_classes(
			pick(statusBox.css_classes, style)
		);
	};

  	/**
	 * @param {keyof pages} pageName
	 * @param {boolean} val
	 */
	const setEmptyStatus = (pageName, val) => {
		const page = pages[pageName];
		if (page === undefined) throw new Error;
		if (val) {
			setStatusStyle("generic");
			page.set_empty(true);
			return;
		}
		page.set_empty(false);
	}

	return forwardSignalMethods(events)({
		bindStatus,
		buildBox,
		consoleBox,
		setEmptyStatus,
		setCurrentPage,
		revealChild,
		unrevealChild,
		addonCountLabel,
		headerboxProfileLabel
	});
};

/**
 * @param {ReturnType<typeof import("./headerbox").default>} headerbox
 * @param {Gtk.Window} window
 */
const bindStatusToHeaderboxSection = (headerbox, profileBar, window) => {
	/**
	 * @type {WeakMap<Status, { binds: GObject.Binding[] }>}
	 */
	const perBoxBindings = new WeakMap;

	/**
	 * @param {ErrorStatus} item
	 */
	function BindError(item) {
		/**
		 * @type {GObject.Binding[]}
		 */
		const binds = [];

		headerbox.bindStatus("error", (_obj, title, description) => {
			title.set_label(_("A Problem Has Occurred"));

			const using_short = bind_property(item,
				"short", profileBar.profileLabel, "label",
				GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

			binds.push(using_short);

			const using_msg = bind_property(item,
				"msg", description, "label",
				GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

			binds.push(using_msg);

		});

		perBoxBindings.set(item, {
			binds,
		});
	}

	/**
	 * @param {BuildStatus} item
	 */
	function BindBuild(item) {
		/**
		 * @type {GObject.Binding[]}
		 */
		const binds = [];

		headerbox.bindStatus("build", (_obj, build_box) => {
			const using_status_in_bar = bind_property(item,
				"status", profileBar.profileLabel, "label",
				GObject.BindingFlags.SYNC_CREATE);

			binds.push(using_status_in_bar);

			const using_status_in_page = bind_property(item,
				"status", build_box, "status",
				GObject.BindingFlags.SYNC_CREATE);

			binds.push(using_status_in_page);

			const using_elapsed = bind_property(item,
				"elapsed", build_box, "elapsed",
				GObject.BindingFlags.SYNC_CREATE);

			binds.push(using_elapsed);

			const using_finish = bind_property_full(item,
				"finished", build_box, "title-type",
				GObject.BindingFlags.SYNC_CREATE,
				/**
				 * @param {boolean | null} from
				 * @return {[boolean, HeaderboxBuildTitleType]}
				 */
				(_binding, from) => {
					if (from === null) return [false, "in-progress"];
					if (from) {
						return [true, "done"];
					} else {
						return [true, "in-progress"];
					}
				}, null);

			binds.push(using_finish);

			const using_time_unit = item.bind_property_full(
				"time-unit", build_box, "time-unit-word",
				GObject.BindingFlags.SYNC_CREATE,
				/**
				 * @param {BuildStatusTimeUnit | null} from
				 * @return {[boolean, HeaderboxBuildTimeUnitWord]}
				 */
				(_binding, from) => {
					if (from === null) return [false, "s"];
					switch (from) {
					case "second":
						return [true, "s"];
					case "milisecond":
						return [true, "ms"];
					default:
						throw new Error;
					}
				}, () => {});

			binds.push(using_time_unit);

		});

		perBoxBindings.set(item, {
			binds,
		});
	}

	/**
	 * @type number[]
	 */
	const statusFactoryBindings = [];

	const use_bind = statusFactory.connect("bind", (_obj, item) => {
		const klasses = Object.values(StatusExports).filter(x => typeof x !== "symbol" && IS_STATUS_KLASS in x);

		for (const klass of klasses) {
			if (typeof klass === "symbol") continue;
			if (item instanceof klass) {
				const procedure = (() => {
					switch (klass) {
					case ErrorStatus:
						return BindError;
					case BuildStatus:
						return BindBuild;
					default:
						throw new Error;
					}
				})();

				procedure(item);

				return;
			}
		}
	});

	statusFactoryBindings.push(use_bind);

	const use_unbind = statusFactory.connect("unbind", (_obj, item) => {
		if (item === null) return;
		const store = perBoxBindings.get(item);
		if (store === undefined) return;
		const { binds } = store;
		binds.forEach(x => {
			x.unbind();
		});
	});

	statusFactoryBindings.push(use_unbind);

	const use_empty = statusFactory.connect("empty", () => {
		profileBar.profileLabel.set_label("");
		headerbox.setEmptyStatus("status_box", true);
	});

	statusFactoryBindings.push(use_empty);

	const use_nonempty = statusFactory.connect("nonempty", () => {
		headerbox.setEmptyStatus("status_box", false);
	});

	statusFactoryBindings.push(use_nonempty);

	// init
	statusFactory.on_items_changed();

	window.connect("close-request", () => {
		statusFactoryBindings.forEach(x => statusFactory.disconnect(x));
		return false;
	});
};

export {
	/**
	 * @deprecated
	 */
	bindStatusToHeaderboxSection
};

export default HeaderBox;
