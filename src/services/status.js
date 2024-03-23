import Gio from "gi://Gio";
import GObject from "gi://GObject";
import { addSignalMethods, forwardSignalMethods } from "../lib/signals.js";

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

export const IS_STATUS_KLASS = Symbol();

export class Status extends GObject.Object {
	static [IS_STATUS_KLASS] = "";

	static last_id = -1;

	static generate_id() {
		const id = String(++Status.last_id);
		return id;
	};

	static {
		GObject.registerClass({
			Properties: {
				id: GObject.ParamSpec.string(
					"id", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
				date: GObject.ParamSpec.jsobject(
					"date", "", "",
					GObject.ParamFlags.READWRITE),
			},
			Signals: {
				"clear": {},
			},
		}, this);
	}

	id = Status.generate_id();
	date = new Date;

	clear() {
		this.emit("clear");
	}
}

export class ErrorStatus extends Status {
	static {
		GObject.registerClass({
			Properties: {
				msg: GObject.ParamSpec.string(
					"msg", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
				short: GObject.ParamSpec.string(
					"short", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
			},
		}, this);
	}

	/**
	 * @param {{
	 *  short: string;
	 *  msg: string;
	 * }} params
	 */
	constructor(params) {
		super(params);
		this.short = params.short;
		this.msg = params.msg;
	}
}

export class BuildStatus extends Status {
	static {
		GObject.registerClass({
			Properties: {
				status: GObject.ParamSpec.string(
					"status", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					null),
				elapsed: GObject.ParamSpec.uint64(
					"elapsed", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					0, Number.MAX_SAFE_INTEGER, 0),
				time_unit: GObject.ParamSpec.string(
					"time-unit", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					"second"),
				finished: GObject.ParamSpec.boolean(
					"finished", "", "",
					GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
					false),
			},
		}, this);
	}

	/**
	 *
	 * @param {Partial<{ status: string; elapsed: number; time_unit: "second" | "milisecond"; finished: boolean }>} params
	 */
	constructor(params = {}) {
		super(params);
		this.status = params.status;
		this.elapsed = params.elapsed;
		this.time_unit = params.time_unit;
		this.finished = params.finished;
	}
}

/**
 * @type {Gio.ListStore<Status>}
 */
export const store = new Gio.ListStore({
	item_type: Status.$gtype,
});

export const topFactory = (() => {
	/**
	 * @type {{}
	 * & Signal<"bind", [item: Status]>
	 * & Signal<"unbind", [item: Status | null]>
	 * & Signal<"empty", []>
	 * & Signal<"nonempty", [item: Status | null]>
	 * & SharedSignalMethods}
	 */
	const events = addSignalMethods();

	/**
	 * @type {?Status}
	 */
	let current = null;

	const on_items_changed = () => {
		const new_idx = store.get_n_items() - 1;
		const new_top = new_idx >= 0 ? (/** @type {?Status} */(store.get_item(new_idx))) : null;
		if (new_top === current) return;
		events.emit("unbind", current);
		current = new_top;
		if (current === null) {
			events.emit("empty");
			return;
		}
		events.emit("nonempty", current);
		events.emit("bind", current);
	};

	store.connect("items-changed", on_items_changed.bind(this));

	return forwardSignalMethods(events)({
		on_items_changed,
	});
})();

/**
 * @type Map<string, Status>
 */
const idmap = new Map;

/**
 * @param {Status} status
 */
export const append = (status) => {
	idmap.set(status.id, status);
	status.connect("clear", () => {
		clearStatus(status.id);
	});
	store.append(status);
};

/**
 * @param {number} idx
 */
export const remove = (idx) => {
	const status = (/** @type {Status | null} */(store.get_item(idx)));
	if (status !== null) {
		idmap.delete(status.id);
	}
	store.remove(idx);
};

/**
 * @param {ConstructorParameters<typeof ErrorStatus>} params
 */
export const addError = (...params) => {
	const status = new ErrorStatus(params[0]);
	append(status);
	return status.id;
};

export const addBuildTracker = () => {
	const status = new BuildStatus();
	append(status);
	return status;
};

/**
 * @param {string} id
 */
export const clearStatus = (id) => {
	const status = idmap.get(id);
	if (status === undefined) return false;
	const [found, idx] = store.find(status);
	if (!found) return false;
	remove(idx);
	return true;
};
