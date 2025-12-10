/**
 * 설정 파일
 * Samsung Galaxy S23+ (SM-S916N) 실제 기기 핑거프린트 기반 설정
 * 소스: s23plus_device_profile.json (browserleaks에서 수집)
 */

// 모바일 디바이스 설정 - Samsung Galaxy S23+ (실제 기기 데이터)
// HAR 분석 기반: User-Agent는 축약형 버전 사용 (142.0.0.0)
export const MOBILE_DEVICE = {
  viewport: { width: 384, height: 701 },  // HAR에서 확인된 실제 뷰포트 (vw, vh)
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  deviceScaleFactor: 2.8125,  // S23+ 실제 DPR
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  colorScheme: 'dark' as const,
};

// Client Hints 헤더 - 도메인별 분리 (HAR 분석 기반)
// 기본 헤더: 모든 도메인에 적용
export const BASE_HEADERS = {
  'accept-language': 'ko-KR,ko;q=0.9',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
};

// 확장 헤더: m.search.naver.com 등 특정 도메인만 적용
export const EXTENDED_HEADERS = {
  'sec-ch-ua-platform-version': '"16.0.0"',
  'sec-ch-ua-model': '"SM-S916N"',
  'sec-ch-ua-full-version-list': '"Chromium";v="142.0.7444.171", "Google Chrome";v="142.0.7444.171", "Not_A Brand";v="99.0.0.0"',
  'sec-ch-ua-arch': '""',
  'sec-ch-ua-bitness': '""',
  'sec-ch-ua-form-factors': '"Mobile"',
  'sec-ch-ua-wow64': '?0',
};

// 확장 헤더를 적용할 도메인 패턴
export const EXTENDED_HEADER_DOMAINS = [
  'm.search.naver.com',
];

// 기존 호환용 (모든 헤더 합침)
export const EXTRA_HEADERS = {
  ...BASE_HEADERS,
  ...EXTENDED_HEADERS,
};

// 네이버 URL
export const NAVER_URLS = {
  MAIN: 'https://m.naver.com',
  SEARCH: 'https://m.search.naver.com/search.naver',
  SHOPPING: 'https://mshopping.naver.com',
};

// 검색 설정
export const SEARCH_CONFIG = {
  // 테스트 상품 검색어
  TEST_PRODUCT: '달빛기정떡',

  // 대기 시간 (ms)
  TIMEOUT: {
    PAGE_LOAD: 30000,
    ELEMENT_WAIT: 10000,
    ACTION_DELAY: 1000,
  },
};

// IP 체크 설정
export const IP_CHECK = {
  URL: 'http://mkt.techb.kr/ip',  // HTTP 사용 (VPN 첫 연결 시 SSL 캐시 없음 문제 회피)
  SERVER_IP: '119.193.40.68',  // 서버 공인 IP (VPN 연결 안 됐을 때의 IP)
};

// VPN IP 토글 설정
export const VPN_TOGGLE = {
  BASE_URL: 'http://112.161.54.7/toggle',
  DEFAULT_DONGLE: 18,
};

// MySQL DB 설정
export const DB_CONFIG = {
  host: '220.121.120.83',
  user: 'naver_shop',
  password: 'Tech1324',
  database: 'naver_shop_rank',
  charset: 'utf8mb4',
};
