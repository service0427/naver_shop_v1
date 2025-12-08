/**
 * 달빛기정떡 관련 검색어
 * 상품: [개별포장]달빛 기정떡 잔기지떡 식사대용 아이간식 떡선물 떡주문 간편식 쫀득한떡 40개 [국산]
 * nv_mid: 88214130348
 */

// "달빛" 키워드 (상품 찾기 쉬움) - 30개
export const DALBIT_KEYWORDS = [
  '달빛기정떡',
  '달빛 기정떡',
  '달빛 기정떡 40개',
  '달빛 기정떡 개별포장',
  '달빛 기정떡 국산',
  '달빛 기정떡 선물',
  '달빛 기정떡 세트',
  '달빛 잔기지떡',
  '달빛 기정떡 간식',
  '달빛 기정떡 아이간식',
  '달빛 기정떡 식사대용',
  '달빛 기정떡 쫀득',
  '달빛 기정떡 맛있는',
  '달빛 기정떡 추천',
  '달빛 기정떡 인기',
  '달빛 기정떡 택배',
  '달빛 기정떡 주문',
  '달빛 떡선물',
  '달빛 떡주문',
  '달빛 쫀득한떡',
  '달빛기정떡 잔기지떡',
  '달빛기정떡 식사대용',
  '달빛기정떡 떡선물',
  '달빛기정떡 간편식',
  '달빛기정떡 쫀득한떡',
  '달빛 개별포장 떡',
  '달빛 국산 기정떡',
  '달빛 선물용 기정떡',
  '달빛떡 40개입',
  '달빛 기정떡 대용량',
];

// "기정떡" 일반 키워드 (15개)
export const GIJEONG_KEYWORDS = [
  '기정떡',
  '기정떡 개별포장',
  '기정떡 선물',
  '기정떡 40개',
  '기정떡 세트',
  '기정떡 국산',
  '기정떡 맛있는',
  '기정떡 추천',
  '기정떡 인기',
  '기정떡 배달',
  '기정떡 주문',
  '기정떡 택배',
  '기정떡 쫀득',
  '기정떡 간편식',
  '기정떡 아이간식',
];

// 전체 키워드 (달빛 우선)
export const KEYWORDS = [...DALBIT_KEYWORDS, ...GIJEONG_KEYWORDS];

/**
 * 랜덤 검색어 선택
 */
export function getRandomKeyword(): string {
  const index = Math.floor(Math.random() * KEYWORDS.length);
  return KEYWORDS[index];
}

/**
 * 가중치 기반 랜덤 검색어 선택
 * "달빛" 키워드에 70% 가중치 (상품 찾기 쉬움)
 */
export function getWeightedRandomKeyword(): string {
  const useDalbitKeyword = Math.random() < 0.7;

  if (useDalbitKeyword) {
    const index = Math.floor(Math.random() * DALBIT_KEYWORDS.length);
    return DALBIT_KEYWORDS[index];
  } else {
    const index = Math.floor(Math.random() * GIJEONG_KEYWORDS.length);
    return GIJEONG_KEYWORDS[index];
  }
}

/**
 * 타겟 상품 정보
 */
export const TARGET_PRODUCT = {
  nv_mid: '88214130348',
  name: '[개별포장]달빛 기정떡 잔기지떡 식사대용 아이간식 떡선물 떡주문 간편식 쫀득한떡 40개 [국산]',
};
