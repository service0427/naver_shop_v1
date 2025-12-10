/**
 * 스크롤 모듈 v2 - 플링(Fling) 스타일
 *
 * 실제 S23+ 기기 HAR 분석 결과 기반:
 * - 스크롤 속도: 1500~2500 px/s (실제 기기 1895 px/s)
 * - 한 번 스크롤 거리: 3000~6000px (실제 기기 5375px)
 * - 관성 감속: 처음 빠르게 → 점점 느려짐
 *
 * 변경 이력:
 * - 2024-12-09: v2 초기 버전 (실제 기기 패턴 분석 기반)
 */

import { Page } from 'patchright';

// v2 설정: 플링 스타일
export const FLING_CONFIG = {
  // 스크롤 속도 (px/s) - 실제 기기 1895 px/s 기준
  SPEED: {
    MIN: 1500,
    MAX: 2500,
  },
  // 한 번 플링 거리 (px) - 실제 기기 5375px 기준
  DISTANCE: {
    MIN: 3000,
    MAX: 6000,
  },
  // 관성 감속 설정
  DECELERATION: {
    // 초기 속도 배율 (1.5 = 150% 속도로 시작)
    INITIAL_MULTIPLIER: 1.5,
    // 감속 계수 (0.85 = 매 프레임 85%로 감속)
    DECAY: 0.85,
    // 최소 속도 (이 이하면 정지)
    MIN_VELOCITY: 50,
  },
  // 휠 이벤트 설정
  WHEEL: {
    // 프레임 간격 (ms) - 60fps 기준 약 16ms
    FRAME_INTERVAL: 16,
    // 간격 변동폭 (±ms)
    INTERVAL_JITTER: 5,
  },
};

/**
 * 유틸리티: 랜덤 범위 값 생성
 */
export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 유틸리티: 가우시안 랜덤 (더 자연스러운 분포)
 */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * 플링 스크롤 - 관성 감속 시뮬레이션
 *
 * 실제 모바일 터치 플링처럼:
 * 1. 초기 속도가 빠름
 * 2. 점점 감속
 * 3. 완전히 멈춤
 */
export async function flingScroll(
  page: Page,
  targetDistance: number,
  options?: {
    speed?: number;  // px/s, 미지정시 랜덤
  }
): Promise<{ duration: number; steps: number; actualDistance: number }> {
  const viewport = page.viewportSize();
  if (!viewport) {
    return { duration: 0, steps: 0, actualDistance: 0 };
  }

  // 마우스를 화면 중앙 근처로 이동 (약간의 랜덤)
  const centerX = viewport.width / 2 + randomBetween(-30, 30);
  const centerY = viewport.height / 2 + randomBetween(-50, 50);
  await page.mouse.move(centerX, centerY);

  const direction = targetDistance > 0 ? 1 : -1;
  const absDistance = Math.abs(targetDistance);

  // 목표 속도 (px/s)
  const targetSpeed = options?.speed ?? randomBetween(FLING_CONFIG.SPEED.MIN, FLING_CONFIG.SPEED.MAX);

  // 초기 속도 (목표보다 빠르게 시작)
  let velocity = targetSpeed * FLING_CONFIG.DECELERATION.INITIAL_MULTIPLIER;

  let scrolled = 0;
  let steps = 0;
  const startTime = Date.now();

  while (scrolled < absDistance && velocity > FLING_CONFIG.DECELERATION.MIN_VELOCITY) {
    // 이번 프레임에서 스크롤할 거리 계산
    const frameInterval = FLING_CONFIG.WHEEL.FRAME_INTERVAL + randomBetween(
      -FLING_CONFIG.WHEEL.INTERVAL_JITTER,
      FLING_CONFIG.WHEEL.INTERVAL_JITTER
    );

    // 이번 프레임의 delta (속도 * 시간)
    let delta = Math.round(velocity * (frameInterval / 1000));

    // 남은 거리보다 크면 조정
    const remaining = absDistance - scrolled;
    if (delta > remaining) {
      delta = remaining;
    }

    // 휠 이벤트 발생
    await page.mouse.wheel(0, delta * direction);
    scrolled += delta;
    steps++;

    // 감속 적용 (약간의 랜덤성 추가)
    const decayJitter = 1 + (Math.random() - 0.5) * 0.1;  // ±5% 변동
    velocity *= FLING_CONFIG.DECELERATION.DECAY * decayJitter;

    // 프레임 대기
    await new Promise(resolve => setTimeout(resolve, frameInterval));
  }

  const duration = Date.now() - startTime;
  return { duration, steps, actualDistance: scrolled };
}

/**
 * 자연스러운 스크롤 (v2) - flingScroll 래퍼
 * v1과 호환되는 인터페이스
 */
export async function naturalScroll(
  page: Page,
  distance: number,
  _options?: {
    duration?: number;
    withPause?: boolean;
  }
): Promise<{ duration: number; steps: number }> {
  const result = await flingScroll(page, distance);
  return { duration: result.duration, steps: result.steps };
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

// v2 스크롤 시퀀스: 실제 기기 패턴 반영 (더 긴 거리, 더 적은 횟수)
export const SEARCH_RESULT_SCROLL_SEQUENCE: ScrollStep[] = [
  {
    name: '1차 플링',
    distanceRange: [2500, 4000],  // 실제 기기 수준
    delayRange: [800, 1500],      // 플링 후 관찰 시간
  },
  {
    name: '2차 플링',
    distanceRange: [2000, 3500],
    delayRange: [1000, 2000],
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

    log(`[SCROLL-v2] ${step.name}: ${distance}px 플링 시작`);
    const result = await flingScroll(page, distance);
    log(`[SCROLL-v2] ${step.name}: ${result.actualDistance}px / ${result.duration}ms (${result.steps}스텝)`);

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
  name: 'v2-fling-style',
  description: '플링(관성) 스크롤 - 실제 S23+ 기기 패턴 기반',
  date: '2024-12-09',
  changes: [
    '스크롤 속도 증가: 386 → 1500~2500 px/s',
    '스크롤 거리 증가: 400~600 → 3000~6000px',
    '관성 감속 시뮬레이션 추가',
    '프레임 기반 스크롤 (60fps)',
  ],
};
