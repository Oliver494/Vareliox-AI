"""Run the mocked production-chat fixture in Linux WebKitGTK, not Chromium.

Usage: python3 scripts/check-chat-webkit.py URL WIDTH HEIGHT [SCREENSHOT.png|-] [ZOOM]
Requires the system GTK3 / WebKit2 4.1 / PyGObject runtime and a display.
The fixture has mocked IPC and cannot execute desktop commands or read keys.
"""
import json
import sys
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

url = sys.argv[1]
width, height = int(sys.argv[2]), int(sys.argv[3])
output = sys.argv[4] if len(sys.argv) > 4 else None
if output == "-":
    output = None
window = Gtk.OffscreenWindow()
window.set_default_size(width, height)
context = WebKit2.WebContext.new_with_website_data_manager(WebKit2.WebsiteDataManager.new_ephemeral())
view = WebKit2.WebView.new_with_context(context)
view.set_zoom_level(float(sys.argv[5]) if len(sys.argv) > 5 else 1)
view.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
window.add(view)
loop = GLib.MainLoop()
status = {"status": "timeout"}
query_active = False


def finish():
    print(json.dumps({"viewport": [view.get_allocated_width(), view.get_allocated_height()], **status}, ensure_ascii=False))
    loop.quit()


def capture():
    try:
        image = window.get_pixbuf()
        if image is None:
            raise RuntimeError("Offscreen window did not produce a screenshot")
        image.savev(output, "png", [], [])
    except Exception as error:
        status["screenshot_error"] = str(error)
    finish()


def checked(widget, result, _data):
    global query_active, status
    query_active = False
    try:
        value = widget.run_javascript_finish(result).get_js_value().to_string()
        current = json.loads(value)
    except Exception as error:
        status = {"status": "failed", "error": str(error)}
        finish()
        return
    if current.get("status") in ("passed", "failed"):
        status = current
        if output:
            capture()
        else:
            finish()


def poll():
    global query_active
    if not query_active:
        query_active = True
        view.run_javascript('JSON.stringify(window.varelioxVisualResult || {status:"running"})', None, checked, None)
    return True


def timeout():
    if status.get("status") == "timeout":
        finish()
    return False


window.show_all()
view.load_uri(url)
GLib.timeout_add(200, poll)
GLib.timeout_add_seconds(25, timeout)
loop.run()
window.destroy()
sys.exit(0 if status.get("status") == "passed" and "screenshot_error" not in status else 1)
