/** 폰·태블릿 판별 (카메라 해상도·MSAA 등). 가로/세로 화면 전환은 viewControls 의 버튼 */
export function isMobile(): boolean {
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 900;
}

/**
 * 주소 ?quality=max → 기기 상관없이 최고 품질 고정 (폰 경량화·자동 하향 없음)
 *      ?quality=0~5 → 그 품질 단계로 고정 (자동 하향 없음)
 */
export function qualityParam(): { max: boolean; level: number | null } {
  const q = new URLSearchParams(location.search).get("quality");
  if (q === "max") return { max: true, level: 0 };
  const n = q !== null && q !== "" ? Number(q) : NaN;
  return { max: false, level: Number.isInteger(n) ? n : null };
}

/** 폰 경량 설정(MSAA 끔·필터 샘플 줄임·카메라 저해상도)을 쓸지 — ?quality=max 면 안 씀 */
export function lightMobile(): boolean {
  return isMobile() && !qualityParam().max;
}
