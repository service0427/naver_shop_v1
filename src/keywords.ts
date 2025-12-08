/**
 * 달빛기정떡 관련 검색어
 * 상품: [개별포장]달빛 기정떡 잔기지떡 식사대용 아이간식 떡선물 떡주문 간편식 쫀득한떡 40개 [국산]
 * nv_mid: 88214130348
 */

// "달빛" + "개별포장" 키워드 (상품 찾기 쉬움) - 30개
export const DALBIT_KEYWORDS = [
  '개별포장 달빛기정떡',
  '개별포장 달빛 기정떡',
  '개별포장 달빛 기정떡 40개',
  '개별포장 달빛 기정떡 국산',
  '개별포장 달빛 기정떡 선물',
  '개별포장 달빛 기정떡 세트',
  '개별포장 달빛 잔기지떡',
  '개별포장 달빛 기정떡 간식',
  '개별포장 달빛 기정떡 아이간식',
  '개별포장 달빛 기정떡 식사대용',
  '개별포장 달빛 기정떡 쫀득',
  '개별포장 달빛 기정떡 맛있는',
  '개별포장 달빛 기정떡 추천',
  '개별포장 달빛 기정떡 인기',
  '개별포장 달빛 기정떡 택배',
  '개별포장 달빛 기정떡 주문',
  '개별포장 달빛 떡선물',
  '개별포장 달빛 쫀득한떡',
  '개별포장 달빛기정떡 잔기지떡',
  '개별포장 달빛기정떡 식사대용',
  '개별포장 달빛기정떡 떡선물',
  '개별포장 달빛기정떡 간편식',
  '개별포장 달빛기정떡 쫀득한떡',
  '개별포장 달빛 국산 기정떡',
  '개별포장 달빛떡 40개입',
  '개별포장 달빛 기정떡 대용량',
  '달빛 기정떡 개별포장',
  '달빛기정떡 개별포장',
  '달빛 개별포장 기정떡',
  '달빛 개별포장 떡',
];

// "기정떡" + "개별포장" 키워드 (15개)
export const GIJEONG_KEYWORDS = [
  '개별포장 기정떡',
  '개별포장 기정떡 선물',
  '개별포장 기정떡 40개',
  '개별포장 기정떡 세트',
  '개별포장 기정떡 국산',
  '개별포장 기정떡 맛있는',
  '개별포장 기정떡 추천',
  '개별포장 기정떡 인기',
  '개별포장 기정떡 배달',
  '개별포장 기정떡 주문',
  '개별포장 기정떡 택배',
  '개별포장 기정떡 쫀득',
  '개별포장 기정떡 간편식',
  '개별포장 기정떡 아이간식',
  '기정떡 개별포장',
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
