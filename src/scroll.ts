/**
 * 스크롤 모듈 - 네이버 봇 탐지 우회를 위한 자연스러운 스크롤 구현
 *
 * 실제 사용자 HAR 분석 기반:
 * - scroll duration: 평균 1528ms (445ms ~ 6526ms)
 * - scroll 간격: 평균 2370ms (934ms ~ 6882ms)
 * - easing: 실제 손가락 스와이프와 유사한 가속/감속
 *
 * 업데이트 이력:
 * - 2025-12-08: 초기 모듈 분리, duration 개선 (643ms → 1200-1500ms)
 */

import { Page } from 'playwright';

// 스크롤 설정 (HAR 분석 기반)
export const SCROLL_CONFIG = {
  // 스크롤 duration (개별 스크롤 지속 시간)
  DURATION: {
    MIN: 800,    // 최소 800ms (실제: 445ms, 여유 확보)
    MAX: 2000,   // 최대 2000ms (실제: 6526ms는 중간 멈춤 포함)
    AVG: 1400,   // 목표 평균 ~1400ms (실제: 1528ms)
  },

  // 스크롤 거리 (px)
  DISTANCE: {
    MIN: 200,
    MAX: 800,
    DEFAULT: 500,
  },

  // 프레임 간격 (requestAnimationFrame 시뮬레이션)
  FRAME: {
    BASE_MS: 16,      // 기본 60fps
    JITTER_MS: 8,     // 랜덤 지터 (실제 기기 변동 시뮬레이션)
  },

  // easing 파라미터
  EASING: {
    // Math.sin 기반 easing의 강도 조절
    INTENSITY: 0.8,   // 0.5~1.0 (높을수록 곡선이 뚜렷)
    BASE_SPEED: 0.5,  // 기본 속도 배율
  },
};

/**
 * 유틸리티: 랜덤 범위 값 생성
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 유틸리티: 가우시안 분포 랜덤 (자연스러운 분포)
 * Box-Muller 변환 사용
 */
export function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(mean + z * stdDev);
}

/**
 * 스크롤 duration 계산 (가우시안 분포로 자연스럽게)
 * 실제 사용자: 평균 1528ms, 표준편차 ~500ms
 */
export function calculateScrollDuration(): number {
  const duration = gaussianRandom(SCROLL_CONFIG.DURATION.AVG, 400);
  // 범위 제한
  return Math.max(
    SCROLL_CONFIG.DURATION.MIN,
    Math.min(SCROLL_CONFIG.DURATION.MAX, duration)
  );
}

/**
 * 스크롤 스텝 수 계산 (duration에 맞춰)
 */
export function calculateScrollSteps(durationMs: number): number {
  const avgFrameTime = SCROLL_CONFIG.FRAME.BASE_MS + SCROLL_CONFIG.FRAME.JITTER_MS / 2;
  return Math.floor(durationMs / avgFrameTime);
}

/**
 * 자연스러운 스크롤 실행 (개선된 버전)
 *
 * @param page Playwright Page 객체
 * @param distance 스크롤 거리 (양수: 아래로, 음수: 위로)
 * @param options 추가 옵션
 */
export async function naturalScroll(
  page: Page,
  distance: number,
  options?: {
    duration?: number;  // 직접 지정 시 사용
    withPause?: boolean; // 중간 멈춤 포함 여부
  }
): Promise<{ duration: number; steps: number }> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return { duration: 0, steps: 0 };
  }

  // duration 계산 (직접 지정 또는 자동 계산)
  const duration = options?.duration ?? calculateScrollDuration();
  const steps = calculateScrollSteps(duration);

  // 스와이프 시작점 계산 (모바일 에뮬레이션)
  const startX = viewport.width / 2 + randomBetween(-30, 30);
  const startY = distance > 0
    ? viewport.height * 0.7 + randomBetween(-20, 20)
    : viewport.height * 0.3 + randomBetween(-20, 20);
  const endY = startY - distance;

  // easing 파라미터
  const easingIntensity = SCROLL_CONFIG.EASING.INTENSITY;
  const baseSpeed = SCROLL_CONFIG.EASING.BASE_SPEED;
  const frameBase = SCROLL_CONFIG.FRAME.BASE_MS;
  const frameJitter = SCROLL_CONFIG.FRAME.JITTER_MS;

  // 중간 멈춤 옵션 (긴 스크롤 시뮬레이션)
  const withPause = options?.withPause ?? false;
  const pauseAt = withPause ? randomBetween(30, 70) / 100 : -1; // 30~70% 지점에서 멈춤
  const pauseDuration = withPause ? randomBetween(300, 800) : 0;

  // 브라우저 컨텍스트에서 스크롤 실행
  await page.evaluate(
    ({ sY, eY, st, easeInt, baseSpd, fBase, fJitter, pAt, pDur }) => {
      return new Promise<void>((resolve) => {
        const totalDist = sY - eY;
        let i = 0;
        let paused = false;

        const doScroll = () => {
          // 중간 멈춤 체크
          if (pAt > 0 && !paused && i / st >= pAt) {
            paused = true;
            setTimeout(doScroll, pDur);
            return;
          }

          if (i >= st) {
            resolve();
            return;
          }

          const prog = i / st;

          // easing: sin 곡선 기반 (부드러운 시작/끝)
          // 0에서 시작 → 중간에서 최대 → 끝에서 0
          const ease = Math.sin(prog * Math.PI);

          // delta 계산: 기본 속도 + easing 가중치
          const delta = (totalDist / st) * (baseSpd + ease * easeInt);

          // 스크롤 실행
          window.scrollBy(0, delta);

          i++;

          // 다음 프레임 (랜덤 지터로 자연스러움 추가)
          const nextFrame = fBase + Math.random() * fJitter;
          setTimeout(doScroll, nextFrame);
        };

        doScroll();
      });
    },
    {
      sY: startY,
      eY: endY,
      st: steps,
      easeInt: easingIntensity,
      baseSpd: baseSpeed,
      fBase: frameBase,
      fJitter: frameJitter,
      pAt: pauseAt,
      pDur: pauseDuration,
    }
  );

  return { duration, steps };
}

/**
 * 스크롤 시퀀스 정의 (검색 결과 탐색용)
 * HAR 분석 기반 자연스러운 스크롤 패턴
 */
export interface ScrollStep {
  name: string;
  distanceRange: [number, number];
  delayRange: [number, number];  // 스크롤 후 대기 시간
  withPause?: boolean;           // 중간 멈춤 포함
}

export const SEARCH_RESULT_SCROLL_SEQUENCE: ScrollStep[] = [
  {
    name: '1차 스크롤 - 쇼핑 영역 노출',
    distanceRange: [400, 600],
    delayRange: [2000, 3000],
  },
  {
    name: '2차 스크롤 - 상품 탐색',
    distanceRange: [500, 700],
    delayRange: [4000, 5000],
    withPause: true,  // 상품 보는 중
  },
  {
    name: '3차 스크롤 - 심층 탐색',
    distanceRange: [600, 900],
    delayRange: [3000, 4000],
  },
  {
    name: '4차 스크롤 - 추가 상품 확인',
    distanceRange: [400, 600],
    delayRange: [2000, 3000],
  },
  {
    name: '5차 스크롤',
    distanceRange: [500, 800],
    delayRange: [1500, 2500],
  },
  {
    name: '6차 스크롤',
    distanceRange: [400, 600],
    delayRange: [1000, 2000],
  },
  {
    name: '상품 재확인 (위로)',
    distanceRange: [-300, -200],
    delayRange: [1500, 2500],
  },
];

/**
 * 스크롤 시퀀스 실행
 */
export async function executeScrollSequence(
  page: Page,
  sequence: ScrollStep[],
  logger?: (msg: string) => void
): Promise<void> {
  const log = logger ?? console.log;

  for (const step of sequence) {
    // log(`[SCROLL] ${step.name}...`);

    const distance = randomBetween(step.distanceRange[0], step.distanceRange[1]);
    const result = await naturalScroll(page, distance, {
      withPause: step.withPause,
    });

    // log(`[SCROLL] duration=${result.duration}ms, steps=${result.steps}`);
    void result; // unused variable suppress

    // 스크롤 후 대기
    const delay = randomBetween(step.delayRange[0], step.delayRange[1]);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * 스크롤 통계 수집 (디버깅/모니터링용)
 */
export interface ScrollStats {
  totalScrolls: number;
  durations: number[];
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
}

export function calculateScrollStats(durations: number[]): ScrollStats {
  if (durations.length === 0) {
    return {
      totalScrolls: 0,
      durations: [],
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
    };
  }

  return {
    totalScrolls: durations.length,
    durations,
    avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
  };
}
