/**
 * 스크롤 모듈 v1 - mouse.wheel 기반 기본 스크롤
 *
 * 특징:
 * - 작은 delta로 여러 번 스크롤 (53~187px)
 * - 느린 속도 (~386 px/s)
 * - 짧은 거리 (400~700px per step)
 *
 * 문제점 (HAR 분석 결과):
 * - 실제 기기 대비 5배 느림
 * - 스크롤 거리 10배 짧음
 * - 봇 감지 위험 있음
 *
 * 변경 이력:
 * - 2024-12-09: v1으로 백업 (v2 플링 스타일로 전환)
 */

import { Page } from 'patchright';

// 휠 스크롤 설정
export const WHEEL_CONFIG = {
  // 휠 delta 범위 (불규칙한 숫자로)
  DELTA: {
    MIN: 53,
    MAX: 187,
  },
  // 휠 간격 (ms)
  INTERVAL: {
    MIN: 80,
    MAX: 250,
  },
};

/**
 * 유틸리티: 랜덤 범위 값 생성
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 빠른 휠 스크롤 (mouse.wheel 사용)
 */
export async function naturalScroll(
  page: Page,
  distance: number,
  _options?: {
    duration?: number;
    withPause?: boolean;
  }
): Promise<{ duration: number; steps: number }> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return { duration: 0, steps: 0 };
  }

  // 마우스를 화면 중앙으로 이동
  const centerX = viewport.width / 2 + randomBetween(-20, 20);
  const centerY = viewport.height / 2 + randomBetween(-30, 30);
  await page.mouse.move(centerX, centerY);

  const direction = distance > 0 ? 1 : -1;
  let remaining = Math.abs(distance);
  let steps = 0;
  let prevDelta = 0;
  const startTime = Date.now();

  while (remaining > 0) {
    // delta 계산 (연속 유사값 방지)
    let delta = randomBetween(WHEEL_CONFIG.DELTA.MIN, WHEEL_CONFIG.DELTA.MAX);

    // 이전 값과 너무 비슷하면 다시 계산
    if (Math.abs(delta - prevDelta) < 20) {
      delta = randomBetween(WHEEL_CONFIG.DELTA.MIN, WHEEL_CONFIG.DELTA.MAX);
    }

    // 남은 거리보다 크면 조정
    if (delta > remaining) {
      delta = remaining;
    }

    await page.mouse.wheel(0, delta * direction);
    remaining -= delta;
    prevDelta = delta;
    steps++;

    // 랜덤 간격 대기
    const interval = randomBetween(WHEEL_CONFIG.INTERVAL.MIN, WHEEL_CONFIG.INTERVAL.MAX);
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  const duration = Date.now() - startTime;
  return { duration, steps };
}

/**
 * 스크롤 시퀀스 정의
 */
export interface ScrollStep {
  name: string;
  distanceRange: [number, number];
  delayRange: [number, number];
  withPause?: boolean;
}

export const SEARCH_RESULT_SCROLL_SEQUENCE: ScrollStep[] = [
  {
    name: '1차 스크롤',
    distanceRange: [400, 600],
    delayRange: [1500, 2500],
  },
  {
    name: '2차 스크롤',
    distanceRange: [500, 700],
    delayRange: [2000, 3000],
  },
  {
    name: '3차 스크롤',
    distanceRange: [400, 600],
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
    const distance = randomBetween(step.distanceRange[0], step.distanceRange[1]);
    await naturalScroll(page, distance);

    const delay = randomBetween(step.delayRange[0], step.delayRange[1]);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * 스크롤 통계
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

// 버전 정보
export const VERSION = {
  name: 'v1-wheel-basic',
  description: '기본 휠 스크롤 - 작은 delta, 느린 속도',
  date: '2024-12-09',
  changes: [
    '초기 버전',
    'delta: 53~187px',
    'interval: 80~250ms',
    '속도: ~386 px/s',
  ],
};
