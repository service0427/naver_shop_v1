/**
 * 설정 파일
 */

// 모바일 디바이스 설정 (Android Chrome 기준)
export const MOBILE_DEVICE = {
  viewport: { width: 412, height: 915 },
  userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
};

// 추가 HTTP 헤더 (CORS 문제를 피하기 위해 cache-control, pragma 제거)
export const EXTRA_HEADERS = {
  'accept-language': 'ko-KR,ko;q=0.9',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
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
  URL: 'https://mkt.techb.kr/ip',
  SERVER_IP: '119.193.40.68',  // 서버 공인 IP (VPN 연결 안 됐을 때의 IP)
};

// VPN IP 토글 설정
export const VPN_TOGGLE = {
  BASE_URL: 'http://112.161.54.7/toggle',
  DEFAULT_DONGLE: 18,
};
