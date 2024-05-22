//var Gtk = imports.gi.Gtk;
var { Object: GObjectObject, Value } = imports.gi.GObject;
var { File, ListModel, ListStore } = imports.gi.Gio;
var { ContentProvider, DragAction } = imports.gi.Gdk;
var {
	ColumnView,
	DragIcon, DragSource, DropTarget, DropControllerMotion,
	FileLauncher,
	Image,
	ListBox,
	SingleSelection,
	Window
} = imports.gi.Gtk;
var { ActionRow } = imports.gi.Adw;

import { MissingWorkspace } from "../error.js";
import ExtendedBuilder from "../lib/builder.js";

/**
 * @template {(...args: any[]) => Promise<void>} T
 * @param {T} x
 */
function nowait(x) {
	/**
	 * @type {(...args: Parameters<typeof x>) => void}
	 */
	const a = (...args) => {
		x(...args).catch(logError);
	};

	return a;
}

/**
 * @param {{ get_height(): number }} view
 * @param {InstanceOf<ListModel>} model
 * @param {number} y
 */
function getIndex(view, model, y) {
	return Math.round(((y - 35) / (view.get_height() - 35)) * (model.get_n_items() - 1));
}

/**
 * @template {Function} T
 * @typedef {T["prototype"]} InstanceOf
 */

/**
 * @param {ReturnType<typeof ExtendedBuilder>} builder
 * @param {InstanceOf<SingleSelection>} selection
 * @param {InstanceOf<ListStore>} buffer
 * @param {InstanceOf<Window>} window
 * @param {() => (Awaited<ReturnType<typeof import("../application.js").loadWorkspace>> | undefined)} getWorkspace
 */
export default function StoboColumnView(builder, selection, buffer, window, getWorkspace) {
	const object = builder.get_object("stobo_column_view", ColumnView);

	let dragX = NaN;
	let dragY = NaN;
	let row = {};

	const thisGetIndex = /** @type {(y: number) => number} */(getIndex.bind(null, object, buffer));

	object.set_model(selection);

	object.connect("activate", nowait(async (_, position) => {
		const modelItem = buffer.get_item(position);
		if (modelItem === null) return;
		if (!("entry" in modelItem) || !(modelItem.entry instanceof WeakRef)) return;
		const x = modelItem.entry.deref();
		if (x === undefined) return;
		if (!("archive" in x) || !(x["archive"] instanceof File)) return;
		const { archive: file } = x;
		const alwaysAsk = true;
		await (new FileLauncher({
			file,
			alwaysAsk
		}).launch(window, null));

		return;
	}));

	const dropTarget = new DropTarget;

	dropTarget.set_gtypes([GObjectObject.$gtype]);
	dropTarget.set_actions(DragAction.MOVE);

	dropTarget.connect("drop", (_, value, _x, y) => {
		if (value === null) throw new Error;

		const sourceIndex = (() => {
			const [found, index] = buffer.find(value)
			if (found) return index;
			else return NaN;
		})();

		if (isNaN(sourceIndex)) throw new Error;

		if (!("entryName" in value) || typeof value["entryName"] !== "string") throw new Error;

		const { entryName: srcEntryName } = value;

		const returnVal = (() => {
			const _workspace = getWorkspace();
			if (_workspace === undefined) throw new MissingWorkspace
			const { requestChangeManualOrder } = _workspace;

			const targetIndex = thisGetIndex(y);
			const targetRow = buffer.get_item(targetIndex);
			// If value or the target row is null, do not accept the drop
			if (targetRow === null) {
				console.debug("Items are null");
				return false;
			}

			if (!("entryName" in targetRow) || typeof targetRow["entryName"] !== "string") throw new Error;

			const { entryName: targetEntryName } = targetRow;

			buffer.remove(sourceIndex)
			buffer.insert(targetIndex, value);
			selection.set_selected(targetIndex);
			requestChangeManualOrder({
				type: "move",
				src: srcEntryName,
				target: targetEntryName,
			});

			// If everything is successful, return true to accept the drop
			return true;
		})();

		if (typeof returnVal !== "boolean") throw new Error;

		return returnVal;
	});

	object.add_controller(dropTarget);

	const dragSource = new DragSource;

	dragSource.set_actions(DragAction.MOVE);

	dragSource.connect("prepare", (_source, x, y) => {
		dragX = x;
		dragY = (y - 35) % ((object.get_height() - 35) / buffer.get_n_items());

		const index = thisGetIndex(y);
		const item = buffer.get_item(index);
		if (item === null) throw new Error;
		row = item;

		const value = new Value();
		value.init(GObjectObject.$gtype);
		value.set_object(item);

		return ContentProvider.new_for_value(value);
	});

	dragSource.connect("drag-begin", (_source, drag) => {
		const dragWidget = new ListBox();

		dragWidget.set_size_request(window.get_default_size()[0], 16);
		dragWidget.add_css_class("boxed-list");

		if (!("entryName" in row) || typeof row["entryName"] !== "string") throw new Error;
		const { entryName: title } = row;

		const dragRow = new ActionRow({ title });
		dragRow.add_prefix(
			new Image({
				iconName: "list-drag-handle-symbolic",
				cssClasses: ["dim-label"],
			}),
		);

		dragWidget.append(dragRow);
		dragWidget.drag_highlight_row(dragRow);

		const icon = DragIcon.get_for_drag(drag);
		// @ts-expect-error
		icon.child = dragWidget;

		drag.set_hotspot(dragX, dragY);
	});

	object.add_controller(dragSource);

	const dropMotion = new DropControllerMotion;

	dropMotion.connect("motion", (_, __, y) => {
		if (!("highlightAt" in object) || !(object["highlightAt"] instanceof Function)) throw new Error;
		const { highlightAt } = object;
		if (!("unhighlightAll" in object) || !(object["unhighlightAll"] instanceof Function)) throw new Error;
		const { unhighlightAll } = object;
		unhighlightAll();
		const idx = thisGetIndex(y);
		const modelItem = buffer.get_item(idx);
		if (modelItem === null) throw new Error;
		const sourceIdx = (() => {
			const [found, idx] = buffer.find(row);
			if (found) return idx;
			else return NaN;
		})();
		if (isNaN(sourceIdx)) throw new Error;
		highlightAt(idx, sourceIdx);
	});

	dropMotion.connect("leave", () => {
		if (!("unhighlightAll" in object) || !(object["unhighlightAll"] instanceof Function)) throw new Error;
		const { unhighlightAll } = object;
		unhighlightAll();
	});

	object.add_controller(dropMotion);

	Object.assign(object, {
		unhighlightAll: () => {
			object.remove_css_class("dragging");
			object.remove_css_class("up");
			object.remove_css_class("down");
		},
		/**
		 * @param {unknown} position
		 */
		highlightAt: (position, sourcePosition) => {
			if (typeof position !== "number") throw new Error;
			if (isNaN(position)) throw new Error;
			const klasses = position < sourcePosition ? ["dragging", "up"] : (position > sourcePosition ? ["dragging", "down"] : ["dragging"]);
			klasses.forEach(x => object.add_css_class(x));
			selection.set_selected(position);
		}
	});

	return object;
}
