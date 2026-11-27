//! Верхние края видимых окон: на них Орфея может сидеть.
//! Края, перекрытые окнами выше по Z-порядку, вырезаются, чтобы сидеть можно было только на видимой части.
//! Координаты физические (как у окна пета), ось Y вниз.

#[derive(serde::Serialize)]
pub struct Ledge {
    /// Дескриптор окна: по нему пет узнаёт «своё» окно, когда его двигают, и едет вместе с ним.
    pub id: isize,
    pub left: i32,
    pub right: i32,
    pub y: i32,
    /// Левый край самого окна: по нему считается сдвиг окна (края кусков меняются ещё и от перекрытий).
    pub wx: i32,
}

/// Уже этого куска края опорой не считаем (физические пиксели).
#[cfg(windows)]
const MIN_LEDGE: i32 = 80;

#[cfg(windows)]
#[tauri::command]
pub fn list_ledges(app: tauri::AppHandle) -> Vec<Ledge> {
    use std::ffi::c_void;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongW, GetWindowTextLengthW, IsIconic, IsWindowVisible,
        IsZoomed, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    unsafe extern "system" fn collect(hwnd: HWND, lp: LPARAM) -> BOOL {
        unsafe { (*(lp.0 as *mut Vec<HWND>)).push(hwnd) };
        BOOL(1)
    }

    let mut hwnds: Vec<HWND> = Vec::with_capacity(256);
    let mut covers: Vec<RECT> = Vec::with_capacity(64);
    let mut out = Vec::new();
    let pet = crate::seat::pet_hwnd(&app);

    unsafe {
        if EnumWindows(Some(collect), LPARAM(&mut hwnds as *mut Vec<HWND> as isize)).is_err() {
            return out;
        }
        // EnumWindows идёт сверху вниз по Z-порядку: всё, что уже в covers, лежит выше текущего окна.
        for hwnd in hwnds {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                continue;
            }
            if hwnd.0 as isize == pet {
                continue; // окно самого пета не опора и не помеха; главное окно приложения — обычная опора
            }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4);
            if cloaked != 0 {
                continue; // окно на другом рабочем столе или спрятано системой
            }
            let mut r = RECT::default();
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut RECT as *mut c_void,
                std::mem::size_of::<RECT>() as u32,
            )
            .is_err()
                || r.right - r.left < MIN_LEDGE
                || r.bottom - r.top < 40
            {
                continue;
            }

            let tool = (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0;
            // Опора: обычное окно с заголовком, не развёрнутое на весь экран.
            if !tool && !IsZoomed(hwnd).as_bool() && GetWindowTextLengthW(hwnd) > 0 {
                let mut segs = vec![(r.left, r.right)];
                for c in &covers {
                    if c.top <= r.top && c.bottom > r.top {
                        segs = cut(segs, c.left, c.right);
                        if segs.is_empty() {
                            break;
                        }
                    }
                }
                for (l, rr) in segs {
                    if rr - l >= MIN_LEDGE {
                        out.push(Ledge { id: hwnd.0 as isize, left: l, right: rr, y: r.top, wx: r.left });
                    }
                }
            }
            // Любое видимое окно (и тулбары тоже) закрывает то, что под ним.
            covers.push(r);
        }
    }
    out
}

#[cfg(not(windows))]
#[tauri::command]
pub fn list_ledges(_app: tauri::AppHandle) -> Vec<Ledge> {
    Vec::new()
}

/// Вычитает отрезок [cl, cr) из набора отрезков.
#[cfg(windows)]
fn cut(segs: Vec<(i32, i32)>, cl: i32, cr: i32) -> Vec<(i32, i32)> {
    let mut res = Vec::with_capacity(segs.len() + 1);
    for (l, r) in segs {
        if cr <= l || cl >= r {
            res.push((l, r));
            continue;
        }
        if l < cl {
            res.push((l, cl));
        }
        if cr < r {
            res.push((cr, r));
        }
    }
    res
}
