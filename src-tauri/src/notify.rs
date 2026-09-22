// Clickable desktop notifications (issue #15). The notification plugin's
// desktop backend fires and forgets, so a click does nothing. On Linux we talk
// to notify-rust directly and wait for the click: it brings the window back and
// emits "mm-notification-clicked" with the channel id for the frontend to open.
// Other platforms return an error and the frontend keeps the plugin path.

#[tauri::command]
pub fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    channel_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use tauri::{Emitter, Manager};

        let handle = notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .auto_icon()
            // "default" is the XDG action for clicking the notification body.
            .action("default", "Open")
            .show()
            .map_err(|e| e.to_string())?;

        // Blocks until the notification is clicked or closed.
        std::thread::spawn(move || {
            handle.wait_for_action(|action| {
                if action != "default" {
                    return;
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit("mm-notification-clicked", channel_id);
            });
        });
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, title, body, channel_id);
        Err("clickable notifications are only implemented on Linux".into())
    }
}
