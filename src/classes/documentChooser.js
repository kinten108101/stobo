import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Pango from "gi://Pango";

export class DocumentRow extends Gtk.Box {
	static {
		GObject.registerClass({}, this);
	}

	constructor(params = {}) {
		super(params);
		this.set_halign(Gtk.Align.FILL);
		this.set_hexpand(true);
		this.set_spacing(8);
		const vbox_left = new Gtk.Box();
		vbox_left.set_halign(Gtk.Align.FILL);
		vbox_left.set_hexpand(true);
		vbox_left.set_orientation(Gtk.Orientation.VERTICAL);

		this.file_name = new Gtk.Label();
		this.file_name.set_label("test.txt"); // placeholder
		this.file_name.set_halign(Gtk.Align.START);
		this.file_name.set_ellipsize(Pango.EllipsizeMode.END);
		this.file_name.add_css_class("file_name");
		vbox_left.append(this.file_name);

		this.append(vbox_left);

		const vbox_right = new Gtk.Box();
		vbox_right.set_orientation(Gtk.Orientation.VERTICAL);
		vbox_right.set_valign(Gtk.Align.CENTER);

		this.append(vbox_right);
	}
}

export class DocumentEntry extends GObject.Object {
	static {
		GObject.registerClass({}, this);
	}

	/**
	 * @param {string} name
	 */
	constructor(name) {
		super({});
		this.name = name;
	}
}

export default class DocumentChooser extends Gtk.Box {
	static {
		GObject.registerClass({}, this);
	}

	constructor(params = {}) {
		super({
			orientation: Gtk.Orientation.VERTICAL,
			widthRequest: 200,
		});
		this.pages = new Map();
		this.add_css_class('documentchooser');

		{
			const vvbox = new Gtk.Box();
			vvbox.set_orientation(Gtk.Orientation.VERTICAL);
			vvbox.set_spacing(2);

			const tophbox = new Gtk.Box();
			tophbox.set_spacing(2);
			tophbox.set_margin_top(2);
			tophbox.set_margin_start(2);
			tophbox.set_margin_end(2);

			this.search_entry = new Gtk.SearchEntry();
			this.search_entry.set_hexpand(true);
			tophbox.append(this.search_entry);

			this.other_documents_button = new Gtk.Button();
			this.other_documents_button.set_icon_name("document-open-symbolic");
			this.other_documents_button.set_action_name("app.open-document-dialog");
			// NOTE(kinten): This is sucks
			this.other_documents_button.connect("clicked", () => {
				this.set_visible(false);
			});
			tophbox.append(this.other_documents_button);

			vvbox.append(tophbox);
			const separator = new Gtk.Separator();
			vvbox.append(separator);
			this.append(vvbox);
		}
		this.stack = new Gtk.Stack();
		const mainpage_box = new Gtk.Box();
		{
			const scroller = new Gtk.ScrolledWindow();
			scroller.set_hexpand(true);
			scroller.set_max_content_height(600);
			scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.ALWAYS);
			scroller.set_propagate_natural_height(true);
			scroller.set_vexpand(true);
			const viewport = new Gtk.Viewport();
			scroller.set_child(viewport);
			this.list = new Gtk.ListView();
			this.list.set_margin_top(0);
			this.list.set_margin_end(2);
			this.list.set_margin_start(2);
			this.list.add_css_class("navigation-sidebar");
			viewport.set_child(this.list);
			mainpage_box.append(scroller);

			this.factory = new Gtk.SignalListItemFactory();
			this.factory.connect("setup", (_obj, listitem) => {
				if (!(listitem instanceof Gtk.ListItem)) throw new Error;
				const widget = new DocumentRow();
				listitem.set_child(widget);
			});
			this.list.set_factory(this.factory);
		}
		const mainpage = this.stack.add_child(mainpage_box);
		this.pages.set("mainpage", mainpage_box);
		mainpage.set_name("mainpage");

		const noresult_box = new Gtk.Box();
		noresult_box.set_halign(Gtk.Align.CENTER);
		noresult_box.set_valign(Gtk.Align.CENTER);
		{
			const content = new Gtk.Box();
			content.add_css_class("noresult_content");

			const no_result = new Gtk.Label();
			no_result.set_label("No Results Found");
			no_result.add_css_class("dim-label");
			content.append(no_result);

			noresult_box.append(content);
		}
		const noresult = this.stack.add_child(noresult_box);
		this.pages.set("noresult", noresult_box);
		noresult.set_name("noresult");

		const empty_box = new Gtk.Box();
		empty_box.set_orientation(Gtk.Orientation.VERTICAL);
		empty_box.set_halign(Gtk.Align.CENTER);
		empty_box.set_valign(Gtk.Align.CENTER);
		{
			const content = new Gtk.Box();
			content.set_orientation(Gtk.Orientation.VERTICAL);
			content.set_halign(Gtk.Align.CENTER);
			content.set_valign(Gtk.Align.CENTER);
			content.add_css_class("empty_page_content");

			const icon = new Gtk.Image();
			icon.set_from_icon_name("document-open-recent-symbolic");
			icon.set_icon_size(Gtk.IconSize.LARGE);
			icon.add_css_class("dim-label");
			content.append(icon);

			const text = new Gtk.Label();
			text.set_label("No Recent Documents");
			text.set_wrap(true);
			text.set_wrap_mode(Pango.WrapMode.WORD_CHAR);
			text.add_css_class("dim-label");
			content.append(text);

			empty_box.append(content);
		}
		const empty = this.stack.add_child(empty_box);
		this.pages.set("empty", empty_box);
		empty.set_name("empty");

		this.append(this.stack);
	}

	set_visible_child_name(name) {
		this.stack.set_visible_child_name(name);
		this.pages.forEach((x, key) => {
			if (key === name) {
				x.set_visible(true);
			} else {
				x.set_visible(false);
			}
		});
	}
}
