//! Р•Р·РґР° РІРјРµСЃС‚Рµ СЃ РѕРєРЅРѕРј. РџРѕРєР° РћСЂС„РµСЏ СЃРёРґРёС‚ РЅР° С‡СѓР¶РѕРј РѕРєРЅРµ, РїРѕРґРїРёСЃС‹РІР°РµРјСЃСЏ РЅР° СЃРёСЃС‚РµРјРЅРѕРµ СЃРѕР±С‹С‚РёРµ
//! В«РѕРєРЅРѕ СЃРґРІРёРЅСѓР»РѕСЃСЊВ» (SetWinEventHook С‚РѕР»СЊРєРѕ РґР»СЏ РїСЂРѕС†РµСЃСЃР° СЌС‚РѕРіРѕ РѕРєРЅР°) Рё РІ С‚РѕС‚ Р¶Рµ РјРёРі РґРІРёРіР°РµРј РѕРєРЅРѕ РїРµС‚Р°
//! РЅР° С‚Сѓ Р¶Рµ РІРµР»РёС‡РёРЅСѓ РїСЂСЏРјРѕ РѕС‚СЃСЋРґР°, Р±РµР· РѕРїСЂРѕСЃР° Рё Р±РµР· РєСЂСѓРіР° С‡РµСЂРµР· JS. Р’ JS СѓС…РѕРґРёС‚ СЃРѕР±С‹С‚РёРµ `seat-moved`
//! СЃ {dx, dy}, С‡С‚РѕР±С‹ С„РёР·РёРєР° Р·РЅР°Р»Р° РЅРѕРІРѕРµ РїРѕР»РѕР¶РµРЅРёРµ. РљРѕРіРґР° РћСЂС„РµСЏ СЃР»РµР·Р»Р°, РїРѕС‚РѕРє СЃ РїРѕРґРїРёСЃРєРѕР№ Р·Р°РІРµСЂС€Р°РµС‚СЃСЏ.

use tauri::{AppHandle, Manager};

/// Р”РµСЃРєСЂРёРїС‚РѕСЂ РѕРєРЅР° РїРµС‚Р° (0, РµСЃР»Рё РѕРєРЅР° РЅРµС‚).
pub fn pet_hwnd(app: &AppHandle) -> isize {
    #[cfg(windows)]
    {
        app.get_webview_window("pet")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize)
            .unwrap_or(0)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        0
    }
}

#[cfg(not(windows))]
pub mod imp {
    #[tauri::command]
    pub fn seat_watch(_app: tauri::AppHandle, _target: isize) {}
}

#[cfg(windows)]
pub mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetMessageW, GetWindowRect, GetWindowThreadProcessId, IsIconic, PeekMessageW, PostThreadMessageW,
        SetWindowPos, EVENT_OBJECT_LOCATIONCHANGE, MSG, OBJID_WINDOW, PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOSIZE,
        SWP_NOZORDER, WINEVENT_OUTOFCONTEXT, WM_QUIT,
    };

    #[derive(Clone, serde::Serialize)]
    struct SeatMoved {
        dx: i32,
        dy: i32,
    }

    struct Watch {
        target: isize,
        pet: isize,
        last: RECT,
        thread: u32,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static WATCH: Mutex<Option<Watch>> = Mutex::new(None);
    /// РќРѕРјРµСЂ РїРѕСЃР»РµРґРЅРµР№ РїРѕРґРїРёСЃРєРё: РїРѕС‚РѕРє, РєРѕС‚РѕСЂС‹Р№ РѕРїРѕР·РґР°Р» Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°С‚СЊСЃСЏ, СЃСЂР°Р·Сѓ РІС‹С…РѕРґРёС‚.
    static GEN: AtomicU64 = AtomicU64::new(0);

    /// Р‘РѕР»СЊС€Рµ С‚Р°РєРѕРіРѕ СЃРєР°С‡РєР° Р·Р° РѕРґРЅРѕ СЃРѕР±С‹С‚РёРµ РЅРµ РїРѕРІС‚РѕСЂСЏРµРј (РѕРєРЅРѕ СЃРІРµСЂРЅСѓР»Рё РёР»Рё СѓРІРµР»Рё Р·Р° СЌРєСЂР°РЅ).
    const MAX_JUMP: i32 = 4000;

    fn bounds(hwnd: HWND) -> Option<RECT> {
        let mut r = RECT::default();
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut RECT as *mut c_void,
                std::mem::size_of::<RECT>() as u32,
            )
            .ok()?;
        }
        Some(r)
    }

    fn stop() {
        if let Ok(mut g) = WATCH.lock() {
            if let Some(w) = g.take() {
                unsafe {
                    let _ = PostThreadMessageW(w.thread, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
    }

    unsafe extern "system" fn on_event(
        _hook: HWINEVENTHOOK,
        _event: u32,
        hwnd: HWND,
        id_object: i32,
        _child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if id_object != OBJID_WINDOW.0 {
            return; // РєСѓСЂСЃРѕСЂ, РєР°СЂРµС‚РєР° Рё РїСЂРѕС‡РёРµ РѕР±СЉРµРєС‚С‹ РІРЅСѓС‚СЂРё РѕРєРЅР°
        }
        let (pet, dx, dy) = {
            let Ok(mut g) = WATCH.lock() else { return };
            let Some(w) = g.as_mut() else { return };
            if hwnd.0 as isize != w.target {
                return;
            }
            if unsafe { IsIconic(hwnd) }.as_bool() {
                return; // СЃРІРµСЂРЅСѓР»Рё: РїСѓСЃС‚СЊ JS Р·Р°РјРµС‚РёС‚ РїСЂРѕРїР°Р¶Сѓ РѕРєРЅР° Рё СѓСЂРѕРЅРёС‚ РћСЂС„РµСЋ
            }
            let Some(r) = bounds(hwnd) else { return };
            let (dx, dy) = (r.left - w.last.left, r.top - w.last.top);
            if (dx == 0 && dy == 0) || dx.abs() > MAX_JUMP || dy.abs() > MAX_JUMP {
                return;
            }
            w.last = r;
            (w.pet, dx, dy)
        };

        let pet = HWND(pet as *mut c_void);
        let mut pr = RECT::default();
        unsafe {
            if GetWindowRect(pet, &mut pr).is_ok() {
                let _ = SetWindowPos(
                    pet,
                    None,
                    pr.left + dx,
                    pr.top + dy,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }
        if let Some(app) = APP.get() {
            let _ = app.emit_to("pet", "seat-moved", SeatMoved { dx, dy });
        }
    }

    /// РќР°С‡Р°С‚СЊ СЃР»РµРґРёС‚СЊ Р·Р° РѕРєРЅРѕРј `target` (0 вЂ” РїРµСЂРµСЃС‚Р°С‚СЊ). РџРѕРІС‚РѕСЂРЅС‹Р№ РІС‹Р·РѕРІ Р·Р°РјРµРЅСЏРµС‚ РїСЂРµР¶РЅСЋСЋ РїРѕРґРїРёСЃРєСѓ.
    #[tauri::command]
    pub fn seat_watch(app: AppHandle, target: isize) {
        let _ = APP.set(app.clone());
        let my_gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
        stop();
        if target == 0 {
            return;
        }
        let pet = super::pet_hwnd(&app);
        let hwnd = HWND(target as *mut c_void);
        let Some(last) = bounds(hwnd) else { return };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32)) };
        if pet == 0 || pid == 0 {
            return;
        }

        std::thread::spawn(move || unsafe {
            // РҐСѓРє С‚РѕР»СЊРєРѕ РЅР° РїСЂРѕС†РµСЃСЃ СЌС‚РѕРіРѕ РѕРєРЅР°: С‡СѓР¶РёРµ СЃРѕР±С‹С‚РёСЏ РґРѕ РЅР°СЃ РґР°Р¶Рµ РЅРµ РґРѕС…РѕРґСЏС‚.
            let hook = SetWinEventHook(
                EVENT_OBJECT_LOCATIONCHANGE,
                EVENT_OBJECT_LOCATIONCHANGE,
                None,
                Some(on_event),
                pid,
                0,
                WINEVENT_OUTOFCONTEXT,
            );
            if hook.is_invalid() {
                return;
            }
            let mut msg = MSG::default();
            // РЎРѕР·РґР°С‘Рј РѕС‡РµСЂРµРґСЊ СЃРѕРѕР±С‰РµРЅРёР№ РґРѕ СЂРµРіРёСЃС‚СЂР°С†РёРё, РёРЅР°С‡Рµ WM_QUIT РѕС‚ stop() РЅРµРєСѓРґР° РїРѕР»РѕР¶РёС‚СЊ.
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            {
                let Ok(mut g) = WATCH.lock() else {
                    let _ = UnhookWinEvent(hook);
                    return;
                };
                if GEN.load(Ordering::SeqCst) != my_gen {
                    drop(g);
                    let _ = UnhookWinEvent(hook);
                    return; // РїРѕРєР° РїРѕС‚РѕРє СЃС‚Р°СЂС‚РѕРІР°Р», РћСЂС„РµСЏ СѓР¶Рµ СЃР»РµР·Р»Р° РёР»Рё РїРµСЂРµСЃРµР»Р°
                }
                *g = Some(Watch { target, pet, last, thread: GetCurrentThreadId() });
            }
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
            let _ = UnhookWinEvent(hook);
        });
    }
}
