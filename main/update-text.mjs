/* 업데이트 상태의 사람이 읽는 문구. Electron 없이 테스트할 수 있게 update.mjs에서 분리했다(원본 WHENMUSIC update.mjs). */
export function createUpdateState() {
  return {
    status:'idle', // idle | checking | available | downloading | ready | error | unsupported
    version:null,
    percent:0,
    error:null, // 사람이 읽을 수 있는 한 줄 (내부 경로·스택 없음)
    checkedAt:null,
  };
}

/** 설정 화면과 트레이가 읽는 한 줄. */
export function updateLine(state, { current = '' } = {}) {
  switch (state.status) {
    case 'checking': return '새 버전 확인 중…';
    case 'available': return `새 버전 ${state.version} 받는 중…`;
    case 'downloading': return `새 버전 ${state.version} 받는 중 ${state.percent}%`;
    case 'ready': return `새 버전 ${state.version} — 앱을 끄면 설치됩니다`;
    case 'error': return state.error ?? '업데이트를 확인하지 못했습니다';
    case 'unsupported': return `버전 ${current} — 업데이트 확인은 설치본에서만`;
    default: return `버전 ${current} — 최신`;
  }
}

/** 오류를 사람 말로. 내부 경로·스택·URL은 사용자가 할 수 있는 일이 없는 문장이라 보여 주지 않는다. */
export function friendlyUpdateError(error) {
  const text = String(error?.message ?? error ?? '');
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(text)) return '네트워크에 연결하지 못했습니다';
  if (/404/.test(text)) return '아직 공개된 릴리스가 없습니다';
  if (/signature|sha512|checksum/i.test(text)) return '내려받은 파일이 손상되어 설치하지 않았습니다';
  return '업데이트를 확인하지 못했습니다';
}
