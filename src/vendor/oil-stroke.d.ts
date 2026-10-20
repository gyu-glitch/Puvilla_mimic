/** 재료 필터 갤러리 '유화 · 획 (세부 보존)' 단독 모듈 (제작자 제공, 원본 그대로 — docs/oil-stroke-guide.md) */
export interface OilParams {
  strength: number;
  size: number;
  boil: number;
  fps: number;
  grade: number;
}
export const DEFAULTS: Readonly<OilParams>;
export class OilStroke {
  constructor(canvas: HTMLCanvasElement, params?: Partial<OilParams>);
  readonly floatOk: boolean;
  /** 마지막 그림에서 CPU 가 쓴 시간 (ms) */
  readonly ms: number;
  params: OilParams;
  set(params: Partial<OilParams>): void;
  frame(source: TexImageSource, t: number): boolean;
  render(source: TexImageSource, seed?: number): void;
  dispose(): void;
}
export function fitSize(srcW: number, srcH: number, short?: number): { w: number; h: number };
