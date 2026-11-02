/* 짧은 알림 토스트(원본 WHENCOMMAND main/toast.mjs). 입력줄을 숨긴 뒤에도 결과를 알려야 할 때 쓴다:
 * 계산 결과 복사, 짧은 스크립트 출력, 지름길 힌트. OS 알림이 아니라 권한을 묻지 않고 알림 센터에 쌓이지 않는다.
 * 커서가 있는 디스플레이 우상단에 4초 머물고, 포커스를 받지 않으며 클릭은 아래 창으로 통과한다. */
import { BrowserWindow, screen, nativeTheme } from 'electron';

const W = 340, H = 96, MARGIN = 16, STAY_MS = 4000;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);

export function createToast() {
  let win = null, timer = null;
  function ensure() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({ width:W, height:H, frame:false, transparent:true, backgroundColor:'#00000000', resizable:false, movable:false,
      minimizable:false, maximizable:false, fullscreenable:false, focusable:false, skipTaskbar:true, hasShadow:false, alwaysOnTop:true, show:false,
      webPreferences:{ sandbox:true, contextIsolation:true, javascript:false } });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:true });
    win.setIgnoreMouseEvents(true);
    win.setMenu?.(null);
    return win;
  }
  /** { title, body } — 제목 한 줄과 본문 두 줄까지. */
  function show({ title = '', body = '' } = {}) {
    const toast = ensure();
    clearTimeout(timer);
    const dark = nativeTheme.shouldUseDarkColors;
    const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent;font:13px Pretendard,"Segoe UI","Malgun Gothic",sans-serif;overflow:hidden}
      .t{margin:6px;padding:12px 14px;border-radius:8px;background:${dark ? '#24282e' : '#ffffff'};color:${dark ? '#e8eaed' : '#30333a'};
        border:1px solid ${dark ? '#3a3f46' : '#dde0e4'};box-shadow:0 6px 18px ${dark ? '#0007' : '#1e283214'}}
      b{display:block;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      p{margin:0;color:${dark ? '#aeb4bb' : '#646a72'};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
    </style><div class="t"><b>${esc(title)}</b><p>${esc(body)}</p></div>`;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    toast.setPosition(area.x + area.width - W - MARGIN, area.y + MARGIN);
    toast.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => { if (!toast.isDestroyed()) toast.showInactive(); }).catch(() => {});
    timer = setTimeout(() => { if (!toast.isDestroyed()) toast.hide(); }, STAY_MS);
  }
  function dispose() { clearTimeout(timer); if (win && !win.isDestroyed()) win.destroy(); win = null; }
  return { show, dispose };
}
