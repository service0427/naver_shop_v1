/**
 * 스크롤 모듈 버전 관리
 *
 * 사용 가능한 버전:
 * - v1: wheel-basic (기본 휠 스크롤, 느린 속도)
 * - v2: fling-style (플링 관성 스크롤, 실제 기기 패턴)
 *
 * 버전 변경 방법:
 * 1. 이 파일에서 CURRENT_VERSION 변경
 * 2. 또는 환경변수 SCROLL_VERSION 설정 (예: SCROLL_VERSION=v1)
 */

// 현재 사용 버전 (여기서 변경)
const CURRENT_VERSION = process.env.SCROLL_VERSION || 'v2';

// 버전별 모듈 import
import * as v1 from './v1-wheel-basic';
import * as v2 from './v2-fling-style';

// 버전 매핑
const versions: Record<string, typeof v1 | typeof v2> = {
  v1,
  'v1-wheel-basic': v1,
  v2,
  'v2-fling-style': v2,
};

// 현재 버전 모듈 선택
const currentModule = versions[CURRENT_VERSION] || v2;

// 버전 정보 출력용
export const SCROLL_VERSION = CURRENT_VERSION;
export const SCROLL_MODULE_INFO = (currentModule as typeof v2).VERSION ?? {
  name: 'v1-wheel-basic',
  description: '기본 휠 스크롤',
  date: '2024-12-09',
};

// 모듈 export (현재 버전)
export const { naturalScroll, executeScrollSequence, randomBetween, calculateScrollStats, SEARCH_RESULT_SCROLL_SEQUENCE } = currentModule;

// 타입 export
export type { ScrollStep, ScrollStats } from './v2-fling-style';

// 버전 전환 함수 (런타임 전환용, 필요시 사용)
export function getScrollModule(version: string) {
  return versions[version] || currentModule;
}

// 사용 가능한 버전 목록
export const AVAILABLE_VERSIONS = Object.keys(versions);
