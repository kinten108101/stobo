#!/usr/bin/env python

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import GLib, Gtk, Adw, Gio
from subprocess import run
from sys import argv


application = None
view_stack = None
attribute_row_list = None
add_popover = None
file = None


def on_row_apply(obj):
    key = obj.get_title()
    newValue = obj.get_text()
    if len(newValue) == 0:
        run(["setfattr", "-x", key, file.get_path()], capture_output=True)
        load_content_page()
    else:
        run(["setfattr", "-n", key, "-v", newValue, file.get_path()], capture_output=True)


def load_content_page(window):
    global attribute_row_list, view_stack, file
    try:
        process = run(["getfattr", "-d", file.get_path()], capture_output=True)
    finally:
        content = [x for x in str(process.stdout).split("\\n")[1:-2]]
        pairs = [x.split("=") for x in content]
        attribute_row_list.remove_all()
        for key, value in pairs:
            value = value[1:-1]
            row = Adw.EntryRow()
            row.set_title(key)
            row.set_text(value)
            row.set_show_apply_button(True)
            row.connect("apply", on_row_apply)
            attribute_row_list.append(row)
        window.set_title(file.get_basename())
        view_stack.set_visible_child_name("content")


def on_file_dialog_open_ready(obj, result, window):
    global file
    try:
        file = obj.open_finish(result)
    except GLib.Error as e:
        print(e)
    else:
        load_content_page(window)
    pass


def on_open_button_clicked(obj, window):
    dialog = Gtk.FileDialog()
    dialog.open(window, None, on_file_dialog_open_ready, window)


def PageDefault(window):
    view = Adw.ToolbarView()
    start_status = Adw.StatusPage();
    start_status.set_title("Open a File");
    start_status.set_description("Drag and drop a file here");
    view.set_content(start_status)
    headerbar = Adw.HeaderBar()
    headerbar.add_css_class("flat")
    open_button = Gtk.Button()
    open_button_content = Adw.ButtonContent()
    open_button_content.set_icon_name("document-open-symbolic")
    open_button_content.set_label("Open")
    open_button.set_child(open_button_content)
    open_button.connect("clicked", on_open_button_clicked, window)
    headerbar.pack_start(open_button)
    view.add_top_bar(headerbar)
    return view


def on_add_button_clicked(obj):
    global add_popover
    add_popover.unparent()
    add_popover.set_parent(obj)
    add_popover.set_visible(True)


def PageContent():
    global attribute_row_list
    view = Adw.ToolbarView()
    headerbar = Adw.HeaderBar()
    headerbar.add_css_class("flat")
    menu = Gtk.MenuButton()
    menu.set_icon_name("open-menu-symbolic")
    menu.set_primary(True)
    headerbar.pack_end(menu)
    view.add_top_bar(headerbar)
    page = Adw.PreferencesPage()

    group_one = Adw.PreferencesGroup()
    attribute_row_list = Gtk.ListBox()
    attribute_row_list.add_css_class("boxed-list")
    group_one.add(attribute_row_list)
    page.add(group_one)

    group_two = Adw.PreferencesGroup()
    add_button = Gtk.Button()
    add_button.add_css_class("pill")
    add_button.set_halign(Gtk.Align.CENTER)
    add_button.set_valign(Gtk.Align.CENTER)
    add_button.connect("clicked", on_add_button_clicked)
    add_button_content = Gtk.Box()
    add_button_content.set_spacing(6);
    add_button_label = Gtk.Label()
    add_button_label.set_label("Add attribute")
    add_button_content.append(add_button_label)
    add_button_suffix = Gtk.Image()
    add_button_suffix.set_from_icon_name("pan-down-symbolic")
    add_button_content.append(add_button_suffix)
    add_button.set_child(add_button_content)
    group_two.add(add_button)
    page.add(group_two)

    view.set_content(page)
    return view


def on_window_close_request(obj):
    global application
    application.quit()
    return True


def AddPopover(window):
    def on_container_notify_visible(obj, prop):
        if not container.get_visible():
            entry.set_text("")
    def on_entry_apply(obj):
        name = entry.get_text()
        if len(name) <= 0:
            return
        run(["setfattr", "-n", name, "-v", "_", file.get_path()], capture_output=True)
        load_content_page(window)
        container.set_visible(False)
    container = Gtk.Popover()
    container.connect("notify::visible", on_container_notify_visible)
    view = Gtk.Box()
    view.set_orientation(Gtk.Orientation.VERTICAL)
    group = Adw.PreferencesGroup()
    entry = Adw.EntryRow()
    entry.set_show_apply_button(True)
    entry.set_title("Key")
    entry.connect("apply", on_entry_apply)
    group.add(entry)
    view.append(group)
    container.set_child(view)
    return container


def on_application_run(obj, provided_file=None):
    global file
    global view_stack
    global add_popover


    window = Adw.ApplicationWindow()
    window.set_title("File Clip")
    window.set_resizable(False)
    window.set_default_size(480, 600)
    window.set_application(obj)

    add_popover = AddPopover(window)

    view_stack = Adw.ViewStack()

    page_default = PageDefault(window)
    page_default_config = view_stack.add(page_default)
    page_default_config.set_name("default")

    page_content = PageContent()
    page_content_config = view_stack.add(page_content)
    page_content_config.set_name("content")

    window.set_content(view_stack)
    window.connect("close-request", on_window_close_request)

    if provided_file:
        file = provided_file
        load_content_page(window)

    window.present()

def a7uz6(self, file_list, _, __):
    retval = 1 if len(file_list) > 1 else -1 if len(file_list) < 1 else 0

    if retval == -1:
        pass
    elif retval == 0:
        file, = file_list
        on_application_run(application, file)
    elif retval == 1:
        print("Cannot open more than one file")

    if retval != -1 and retval != 0:
        pass
    pass

def b71ya(self, options):
    "Don't do anything yet"
    return -1

application = Adw.Application(
    application_id="com.app.test" if "@" in "@APPID@" else "@APPID@",
    flags=Gio.ApplicationFlags.HANDLES_OPEN,
    register_session=True,
)
application.connect("open", a7uz6)
application.connect("handle-local-options", b71ya)
application.connect("activate", on_application_run)
application.run(argv)
