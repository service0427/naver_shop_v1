/**
 * 스크롤 모듈 - 버전 관리 시스템
 *
 * 버전 변경 방법:
 * 1. src/scroll/index.ts에서 CURRENT_VERSION 변경
 * 2. 환경변수 SCROLL_VERSION 설정 (예: SCROLL_VERSION=v1 npm start)
 *
 * 사용 가능한 버전:
 * - v1: wheel-basic (기본 휠 스크롤, 느린 속도, 봇 감지 위험)
 * - v2: fling-style (플링 관성 스크롤, 실제 기기 패턴) [현재 기본값]
 *
 * 버전 히스토리:
 * - v1 (2024-12-09): 초기 버전, delta 53~187px, 속도 ~386px/s
 * - v2 (2024-12-09): 플링 스타일, 속도 1500~2500px/s, 관성 감속
 */

// 버전 관리 모듈에서 모든 것을 re-export
export {
  naturalScroll,
  executeScrollSequence,
  randomBetween,
  calculateScrollStats,
  SEARCH_RESULT_SCROLL_SEQUENCE,
  SCROLL_VERSION,
  SCROLL_MODULE_INFO,
  getScrollModule,
  AVAILABLE_VERSIONS,
} from './scroll/index';

export type { ScrollStep, ScrollStats } from './scroll/index';
