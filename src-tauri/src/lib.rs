use tauri::Manager;

mod platforms;
mod seat;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            // РџРµС‚ РћСЂС„РµРё Р¶РёРІС‘С‚ РІ РѕС‚РґРµР»СЊРЅРѕРј РѕРєРЅРµ РїРѕРІРµСЂС… РѕСЃС‚Р°Р»СЊРЅС‹С…. Р•СЃР»Рё Р·Р°РєСЂС‹Р»Рё РіР»Р°РІРЅРѕРµ РѕРєРЅРѕ, Р·Р°РІРµСЂС€Р°РµРј
            // РїСЂРёР»РѕР¶РµРЅРёРµ С†РµР»РёРєРѕРј, РёРЅР°С‡Рµ РїРµС‚ РѕСЃС‚Р°Р»СЃСЏ Р±С‹ РЅР° СЌРєСЂР°РЅРµ Р±РµР· РёРЅС‚РµСЂС„РµР№СЃР°.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![greet, platforms::list_ledges, seat::imp::seat_watch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
