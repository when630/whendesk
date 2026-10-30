export const SHORTCUT_FIELDS = Object.freeze(['hotkey', 'captureHotkey', 'noteCaptureHotkey', 'mediaPlayHotkey', 'mediaRewindHotkey', 'mediaForwardHotkey']);
const FIELDS = SHORTCUT_FIELDS;
const LABELS = { hotkey:'WHENCOMMAND 열기', captureHotkey:'할 일 빠르게 담기', noteCaptureHotkey:'메모 빠르게 담기', mediaPlayHotkey:'음악 재생·일시정지', mediaRewindHotkey:'음악 10초 되감기', mediaForwardHotkey:'음악 10초 앞으로' };
const MODIFIERS = new Map(Object.entries({ control:'Control', ctrl:'Control', command:'Command', cmd:'Command', commandorcontrol:'CommandOrControl', cmdorctrl:'CommandOrControl', alt:'Alt', option:'Alt', altgr:'AltGr', shift:'Shift', super:'Super', meta:'Super' }));
const ORDER = ['CommandOrControl', 'Control', 'Command', 'Alt', 'AltGr', 'Shift', 'Super'];
const NAMED_KEYS = new Map(['Plus','Space','Tab','Capslock','Numlock','Scrolllock','Backspace','Delete','Insert','Return','Up','Down','Left','Right','Home','End','PageUp','PageDown','Escape','VolumeUp','VolumeDown','VolumeMute','MediaNextTrack','MediaPreviousTrack','MediaStop','MediaPlayPause','PrintScreen','numdec','numadd','numsub','nummult','numdiv'].map(key => [key.toLowerCase(), key]));
for (const [alias,key] of Object.entries({ enter:'Return', esc:'Escape', spacebar:'Space', del:'Delete', pgup:'PageUp', pgdn:'PageDown' })) NAMED_KEYS.set(alias,key);

function shortcutError(fields) {
  const error = new Error(Object.entries(fields).map(([field,message]) => `${LABELS[field]}: ${message}`).join('\n'));
  error.fields = fields;
  return error;
}

export function normalizeAccelerator(value, { platform = process.platform } = {}) {
  if (typeof value !== 'string' || value.length > 99) throw new Error('단축키를 올바른 키 조합으로 입력해 주세요.');
  if (!value.trim()) return '';
  const pieces = value.trim().replace(/\s*\+\s*/g, '+').replace(/\+\+$/, '+Plus').split('+');
  const rawKey = pieces.pop();
  const modifiers = pieces.map(part => MODIFIERS.get(part.toLowerCase()));
  if (!rawKey || modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length) throw new Error('예: Ctrl+Alt+Space 또는 Ctrl+Alt+L 형식으로 입력해 주세요.');
  let key = NAMED_KEYS.get(rawKey.toLowerCase());
  if (!key && /^[a-z0-9]$/i.test(rawKey)) key = rawKey.toUpperCase();
  if (!key && /^f(?:[1-9]|1\d|2[0-4])$/i.test(rawKey)) key = rawKey.toUpperCase();
  if (!key && /^num[0-9]$/i.test(rawKey)) key = rawKey.toLowerCase();
  if (!key && /^[!"#$%&'()*,\-./:;<=>?@[\\\]^_`{|}~]$/.test(rawKey)) key = rawKey;
  if (!key) throw new Error('지원하는 키 이름인지 확인해 주세요. 예: Space, L, /');
  if (!modifiers.some(modifier => ['Control','Command','CommandOrControl','Alt','Super'].includes(modifier)) && !/^F\d+$/.test(key) && !/^(?:Media|Volume)/.test(key)) throw new Error('일반 입력을 방해하지 않도록 Ctrl·Alt 같은 보조 키를 함께 사용해 주세요.');
  const normalized = modifiers.map(modifier => modifier === 'CommandOrControl' ? platform === 'darwin' ? 'Command' : 'Control' : modifier);
  if (new Set(normalized).size !== normalized.length) throw new Error('같은 보조 키를 중복해서 지정할 수 없습니다.');
  normalized.sort((a,b) => ORDER.indexOf(a)-ORDER.indexOf(b));
  return [...normalized,key].join('+');
}

export function normalizeShortcutValues(values, options) {
  const normalized = {}, fields = {};
  for (const field of FIELDS) {
    try { normalized[field] = normalizeAccelerator(values[field] ?? '', options); }
    catch (error) { fields[field] = error.message; }
    if (/^(?:(?:Control|Command)\+(?:[KNSFEPZ]|\/|Return|Shift\+[NAZIEMBT])|Alt\+(?:Return|[HTIWDNCS]))$/.test(normalized[field] || '')) fields[field] = '앱 내부 단축키와 겹칩니다. 다른 조합을 지정해 주세요.';
  }
  if (!Object.keys(fields).length) {
    for (const field of FIELDS) for (const other of FIELDS) if (field !== other && normalized[field] && normalized[field] === normalized[other]) fields[field] = '서로 다른 단축키를 지정해 주세요.';
  }
  if (Object.keys(fields).length) throw shortcutError(fields);
  return normalized;
}

/** 새 키를 확보하고 설정 저장까지 성공한 뒤 기존 키를 해제한다. */
export function createShortcutManager({ globalShortcut, handlers, enabled = true }) {
  let bindings = new Map(), errors = {};
  const callback = accelerator => () => handlers[bindings.get(accelerator)]?.();
  const status = () => ({
    shortcutsEnabled:enabled,
    ...Object.fromEntries(FIELDS.map(field => [field + 'Ok', [...bindings.values()].includes(field)])),
    shortcutErrors:{ ...errors },
  });
  function normalize(values) {
    try { return normalizeShortcutValues(values); }
    catch (error) { errors = { ...error.fields }; throw error; }
  }
  function register(accelerator) {
    try { return !!globalShortcut.register(accelerator,callback(accelerator)); }
    catch { return false; }
  }
  function initialize(values) {
    errors = {};
    let normalized;
    try { normalized = normalize(values); } catch { return status(); }
    if (!enabled) return status();
    for (const field of FIELDS) {
      const accelerator = normalized[field];
      if (!accelerator) continue;
      if (register(accelerator)) bindings.set(accelerator,field);
      else errors[field] = '다른 앱에서 사용 중이거나 등록할 수 없는 조합입니다.';
    }
    return status();
  }
  function update(values, commit = () => values) {
    const normalized = normalize(values);
    const desired = new Map(FIELDS.filter(field => normalized[field]).map(field => [normalized[field],field]));
    const additions = [];
    errors = {};
    try {
      if (enabled) for (const [accelerator,field] of desired) {
        if (bindings.has(accelerator)) continue;
        if (!register(accelerator)) throw shortcutError({ [field]:'다른 앱에서 사용 중이거나 등록할 수 없는 조합입니다.' });
        additions.push(accelerator);
      }
      const result = commit({ ...values, ...normalized });
      if (result?.then) throw new Error('단축키 설정 저장은 동기적으로 완료해야 합니다.');
      if (enabled) {
        const previous = bindings; bindings = desired;
        for (const accelerator of previous.keys()) if (!desired.has(accelerator)) globalShortcut.unregister(accelerator);
      }
      return result;
    } catch (error) {
      for (const accelerator of additions) globalShortcut.unregister(accelerator);
      errors = { ...(error.fields || {}) };
      throw error;
    }
  }
  function dispose() { for (const accelerator of bindings.keys()) globalShortcut.unregister(accelerator); bindings = new Map(); }
  return { initialize, update, status, dispose };
}
