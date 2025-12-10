/**
 * 상품 정보 및 검색어 생성
 *
 * 상품 변경 시 이 파일만 수정하면 됩니다:
 * 1. TARGET_PRODUCT.nv_mid - 상품 고유 ID
 * 2. TARGET_PRODUCT.name - 상품명 (참조용)
 * 3. PRODUCT_KEYWORDS - 상품명에서 추출한 키워드
 * 4. REQUIRED_KEYWORDS - 필수 포함 키워드
 */

// ============================================================
// 타겟 상품 정보 (여기만 수정하세요)
// ============================================================
export const TARGET_PRODUCT = {
  nv_mid: '88214130348',
  name: '[개별포장]달빛 기정떡 잔기지떡 식사대용 아이간식 떡선물 떡주문 간편식 쫀득한떡 40개 [국산]',
};

// 상품명에서 추출한 키워드 (특수문자 제거, 띄어쓰기로 분리)
export const PRODUCT_KEYWORDS = [
  '개별포장',
  '달빛',
  '기정떡',
  '잔기지떡',
  '식사대용',
  '아이간식',
  '떡선물',
  '떡주문',
  '간편식',
  '쫀득한떡',
  '40개',
  '국산',
];

// 필수 키워드 (검색 시 항상 포함)
export const REQUIRED_KEYWORDS = ['달빛', '기정떡'];

// ============================================================
// 아래는 자동 처리 (수정 불필요)
// ============================================================

// 선택 키워드 (필수 제외한 나머지)
export const OPTIONAL_KEYWORDS = PRODUCT_KEYWORDS.filter(
  kw => !REQUIRED_KEYWORDS.includes(kw)
);

/**
 * 배열 셔플 (Fisher-Yates)
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * 랜덤 검색어 생성
 * - 필수 키워드 항상 포함 (달빛, 기정떡)
 * - 추가 2~6개 랜덤 선택 (총 4~8개)
 * - 순서 랜덤 셔플
 */
export function getRandomKeyword(): string {
  // 추가 키워드 개수 (2~6개)
  const additionalCount = Math.floor(Math.random() * 5) + 2; // 2, 3, 4, 5, 6

  // 선택 키워드 셔플 후 필요한 개수만큼 선택
  const shuffledOptional = shuffle(OPTIONAL_KEYWORDS);
  const selectedOptional = shuffledOptional.slice(0, additionalCount);

  // 필수 + 선택 키워드 합치고 셔플
  const allKeywords = shuffle([...REQUIRED_KEYWORDS, ...selectedOptional]);

  return allKeywords.join(' ');
}
