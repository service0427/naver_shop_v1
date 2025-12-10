import { chromium, BrowserContext, Page } from 'patchright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { MOBILE_DEVICE, NAVER_URLS, SEARCH_CONFIG, BASE_HEADERS, EXTENDED_HEADERS, EXTENDED_HEADER_DOMAINS, IP_CHECK, VPN_TOGGLE, DB_CONFIG } from './config';
import * as mysql from 'mysql2/promise';
import {
  executeScrollSequence,
  SEARCH_RESULT_SCROLL_SEQUENCE,
  randomBetween,
  naturalScroll,
  SCROLL_VERSION,
  SCROLL_MODULE_INFO,
} from './scroll';
import { TARGET_PRODUCT, getRandomKeyword } from './product';

// CLI 옵션 파싱
const USE_VPN = process.argv.some(arg => arg.startsWith('--vpn'));
const VPN_DONGLE = parseInt(
  process.argv.find(arg => arg.startsWith('--vpn='))?.split('=')[1] || '18',
  10
);
// --repeat 또는 --repeat=N 둘 다 인식
const REPEAT_MODE = process.argv.some(arg => arg === '--repeat' || arg.startsWith('--repeat='));
// --repeat=N이 있으면 N, 없으면 1 (기본값 10 제거)
const REPEAT_COUNT_ARG = process.argv.find(arg => arg.startsWith('--repeat='))?.split('=')[1];
const REPEAT_COUNT = REPEAT_COUNT_ARG ? parseInt(REPEAT_COUNT_ARG, 10) : 1;
const REPEAT_DELAY = parseInt(
  process.argv.find(arg => arg.startsWith('--delay='))?.split('=')[1] || '30',
  10
) * 1000;  // 초 → ms

// --parallel: 병렬 실행 모드 (자동 종료, GUI 없음 처럼 동작)
const PARALLEL_MODE = process.argv.some(arg => arg === '--parallel');
// 자동 종료 모드: repeat 또는 parallel
const AUTO_EXIT_MODE = REPEAT_MODE || PARALLEL_MODE;

// VPN 동글 범위 (16~19)
const VPN_DONGLES = [16, 17, 18, 19];

// 마스터 프로세스 여부 (--repeat만 있고 --vpn 없으면 마스터)
const IS_REPEAT_MASTER = REPEAT_MODE && !USE_VPN;

// 세션 ID (마스터에서 생성, 자식에게 전달)
// --session=YYYYMMDD_HHMMSS 형태로 전달받음
const SESSION_ID = process.argv.find(arg => arg.startsWith('--session='))?.split('=')[1]
  || (IS_REPEAT_MASTER ? new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '').replace(/-/g, '') : null);

// 회차 번호 (--round=N 형태로 전달받음)
const ROUND_NUMBER = parseInt(
  process.argv.find(arg => arg.startsWith('--round='))?.split('=')[1] || '0',
  10
);

// 디버그 폴더 경로
const DEBUG_BASE = path.join(__dirname, '..', 'debug');
// VPN 토글 상태 파일 경로
const VPN_TOGGLE_STATE_FILE = path.join(__dirname, '..', 'vpn_toggle_state.json');
// VPN 토글 최소 간격 (초)
const VPN_TOGGLE_COOLDOWN_SECONDS = 30;
// 유저 데이터 폴더 (VPN 동글별 분리 - 병렬 처리 지원)
// user_data/vpn_16, user_data/vpn_17, user_data/vpn_18, user_data/vpn_19
const USER_DATA_BASE = path.join(__dirname, '..', 'user_data');
const USER_DATA_DIR = USE_VPN
  ? path.join(USER_DATA_BASE, `vpn_${VPN_DONGLE}`)
  : path.join(USER_DATA_BASE, 'default');
// 세션 ID가 있으면 세션 폴더 사용, 없으면 기본 debug 폴더
const DEBUG_DIR = SESSION_ID ? path.join(DEBUG_BASE, SESSION_ID) : DEBUG_BASE;
const MAX_DEBUG_FILES = 50;

// 로그 저장용 배열
const logBuffer: string[] = [];

// 네트워크 요청 로그 (status만 저장)
interface NetworkLog {
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  type: 'request' | 'response';
}
const networkLogs: NetworkLog[] = [];

// KST 시간 포맷 함수 (HH:MM:SS.mmm 형식)
function getKSTTimestamp(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // HH:MM:SS.mmm 형식으로 반환
  return kst.toISOString().slice(11, 23);
}

// KST 파일명용 포맷 (YYYY-MM-DD_HH-mm-ss)
function getKSTFileTimestamp(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

// 콘솔 로그 래퍼
function log(message: string): void {
  const timestamp = getKSTTimestamp();
  const logLine = `[${timestamp}] ${message}`;
  console.log(logLine);
  logBuffer.push(logLine);
}

/**
 * 네이버 쇼핑 검색 자동화
 *
 * 플로우:
 * 1. 네이버 메인 접근
 * 2. 통합검색 실행
 * 3. 검색 결과에서 상품 찾기
 * 4. 없으면 쇼핑 카테고리로 이동하여 찾기
 */
class NaverShopSearcher {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string;
  private currentIp: string = '';
  private keyword: string = '';
  private vpnDongle: number = 0;
  // NNB 추적용
  private issuedNnb: string = '';  // 발급된 오리지널 NNB
  private usedNnb: string = '';    // 실제 사용된 NNB (풀링된 것 또는 오리지널)

  constructor() {
    // 회차 번호가 있으면 prefix로 추가 (01_, 02_, ...)
    const roundPrefix = ROUND_NUMBER > 0 ? `${String(ROUND_NUMBER).padStart(2, '0')}_` : '';
    this.sessionId = roundPrefix + getKSTFileTimestamp();
    this.ensureDebugDir();
  }

  /**
   * 디버그 폴더 생성 및 오래된 파일 정리
   */
  private ensureDebugDir(): void {
    if (!fs.existsSync(DEBUG_DIR)) {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }
    this.cleanOldDebugFiles();
  }

  /**
   * 오래된 디버그 파일 정리 (최대 10개 유지)
   */
  private cleanOldDebugFiles(): void {
    const files = fs.readdirSync(DEBUG_DIR)
      .filter(f => f.endsWith('.html') || f.endsWith('.log'))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(DEBUG_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    // HTML과 LOG 각각 10개씩 유지
    const htmlFiles = files.filter(f => f.name.endsWith('.html'));
    const logFiles = files.filter(f => f.name.endsWith('.log'));

    htmlFiles.slice(MAX_DEBUG_FILES).forEach(f => {
      fs.unlinkSync(path.join(DEBUG_DIR, f.name));
    });

    logFiles.slice(MAX_DEBUG_FILES).forEach(f => {
      fs.unlinkSync(path.join(DEBUG_DIR, f.name));
    });
  }

  /**
   * HTML 저장
   */
  private async saveHtml(step: string): Promise<void> {
    if (!this.page) return;

    const html = await this.page.content();
    const filename = `${this.sessionId}_${step}.html`;
    fs.writeFileSync(path.join(DEBUG_DIR, filename), html, 'utf-8');
    log(`[DEBUG] HTML 저장: ${filename}`);
  }

  /**
   * 로그 파일 저장
   */
  private saveLog(): void {
    const filename = `${this.sessionId}.log`;
    fs.writeFileSync(path.join(DEBUG_DIR, filename), logBuffer.join('\n'), 'utf-8');
  }

  /**
   * 브라우저 초기화 (Persistent Context - 캐시 유지, fingerprint 초기화)
   */
  async init(): Promise<void> {
    log(`[1] 브라우저 초기화 중... (유저폴더: ${path.basename(USER_DATA_DIR)})`);
    log(`[1] 스크롤 모듈: ${SCROLL_VERSION} - ${SCROLL_MODULE_INFO.description}`);

    // 유저 데이터 폴더 생성
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
      log(`[1] 유저폴더 생성됨: ${USER_DATA_DIR}`);
    }

    // Fingerprint 관련 데이터 삭제 (캐시는 유지)
    this.cleanFingerprintData();

    // 모바일 뷰포트(412) + 개발자도구 (빈 공간 최소화)
    const WINDOW_WIDTH = 1014;
    const WINDOW_HEIGHT = 1080;

    // launchPersistentContext: 캐시/쿠키 유지하면서 브라우저 실행
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      slowMo: 50,
      devtools: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--window-position=80,0',
        `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
      ],
      userAgent: MOBILE_DEVICE.userAgent,
      locale: MOBILE_DEVICE.locale,
      timezoneId: MOBILE_DEVICE.timezoneId,
      colorScheme: MOBILE_DEVICE.colorScheme,
      hasTouch: true,
      viewport: null,  // 창 크기 제한 해제
      extraHTTPHeaders: BASE_HEADERS,
    });

    // navigator 객체 오버라이드 - context 레벨에서 설정 (모든 페이지에 적용)
    await this.setupNavigatorOverrides();

    // 기존 페이지 사용 또는 새 페이지 생성
    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // 모바일 뷰포트는 페이지에서 설정
    await this.page.setViewportSize(MOBILE_DEVICE.viewport);
    this.page.setDefaultTimeout(SEARCH_CONFIG.TIMEOUT.PAGE_LOAD);
    await this.page.bringToFront();

    // 도메인별 Client Hints 헤더 적용
    await this.setupDomainHeaders();

    log('[1] 브라우저 초기화 완료 (Persistent Context, DevTools 활성화)');
  }

  /**
   * Fingerprint 관련 데이터 삭제 (캐시는 유지)
   * - 쿠키 삭제 (NNB 등 fingerprint 쿠키 포함)
   * - Local Storage, Session Storage, IndexedDB 삭제
   * - Service Worker 삭제
   * - 캐시는 유지 (스크립트, 이미지 등)
   * 참고: https://github.com/service0427/coupang_agent_v2/blob/main/lib/utils/browser-helpers.js
   */
  private cleanFingerprintData(): void {
    const defaultPath = path.join(USER_DATA_DIR, 'Default');

    // 1. 삭제할 파일/폴더 목록 (캐시 제외)
    const filesToDelete = [
      'Cookies',           // 쿠키 DB (NNB, _abck 등)
      'Cookies-journal',   // 쿠키 저널
      'Session Storage',   // 세션 스토리지 (폴더)
      'Local Storage',     // 로컬 스토리지 (폴더)
      'IndexedDB',         // IndexedDB (폴더)
      'Service Worker',    // 서비스 워커 (폴더)
      'Web Data',          // autofill 등
      'Web Data-journal',
      'History',           // 방문 기록
      'History-journal',
      'Visited Links',     // 방문한 링크
    ];

    for (const file of filesToDelete) {
      const filePath = path.join(defaultPath, file);
      try {
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          log(`[CLEAN] 삭제됨: ${file}`);
        }
      } catch (e) {
        // 삭제 실패해도 계속 진행
      }
    }

    // 2. Preferences 정리 (복구 메시지 방지)
    this.cleanChromePreferences();

    // 3. Local State 정리
    this.cleanLocalState();
  }

  /**
   * Chrome Preferences 정리 - 복구 메시지 방지
   */
  private cleanChromePreferences(): void {
    const prefsPath = path.join(USER_DATA_DIR, 'Default', 'Preferences');
    try {
      if (!fs.existsSync(prefsPath)) return;

      const prefsData = fs.readFileSync(prefsPath, 'utf8');
      const prefs = JSON.parse(prefsData);

      // 정상 종료로 표시 (복구 메시지 방지)
      if (!prefs.profile) prefs.profile = {};
      prefs.profile.exit_type = 'Normal';
      prefs.profile.exited_cleanly = true;

      // 세션 복원 비활성화
      if (!prefs.session) prefs.session = {};
      prefs.session.restore_on_startup = 5;  // 새 탭 페이지로 시작

      // 기본 브라우저 체크 비활성화
      if (!prefs.browser) prefs.browser = {};
      prefs.browser.check_default_browser = false;

      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
      log('[CLEAN] Preferences 정리 완료');
    } catch (e) {
      // 실패해도 계속 진행
    }
  }

  /**
   * Chrome Local State 정리
   */
  private cleanLocalState(): void {
    const localStatePath = path.join(USER_DATA_DIR, 'Local State');
    try {
      if (!fs.existsSync(localStatePath)) return;

      const stateData = fs.readFileSync(localStatePath, 'utf8');
      const state = JSON.parse(stateData);

      if (!state.profile) state.profile = {};
      if (!state.profile.info_cache) state.profile.info_cache = {};

      if (state.profile.info_cache.Default) {
        state.profile.info_cache.Default.is_using_default_name = true;
        state.profile.info_cache.Default.is_ephemeral = false;
      }

      fs.writeFileSync(localStatePath, JSON.stringify(state, null, 2));
    } catch (e) {
      // 실패해도 계속 진행
    }
  }

  /**
   * navigator 객체 오버라이드 (봇 탐지 우회)
   * S23+ 실제 기기 값 기반 (devices/s23plus_device_profile.json)
   */
  private async setupNavigatorOverrides(): Promise<void> {
    if (!this.context) return;

    // context 레벨에서 설정 - 모든 페이지/iframe에서 실행됨
    await this.context.addInitScript(() => {
      // S23+ 실기기 정보 매칭 (devices/s23plus_device_profile.json 기반)

      // 1. navigator.webdriver 제거
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
      });

      // 2. navigator.userAgentData (Client Hints API)
      const userAgentData = {
        brands: [
          { brand: 'Chromium', version: '142' },
          { brand: 'Google Chrome', version: '142' },
          { brand: 'Not_A Brand', version: '99' },
        ],
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: async (hints: string[]) => {
          const values: Record<string, unknown> = {
            brands: [
              { brand: 'Chromium', version: '142' },
              { brand: 'Google Chrome', version: '142' },
              { brand: 'Not_A Brand', version: '99' },
            ],
            mobile: true,
            platform: 'Android',
          };
          if (hints.includes('platformVersion')) values.platformVersion = '16.0.0';
          if (hints.includes('architecture')) values.architecture = '';
          if (hints.includes('bitness')) values.bitness = '';
          if (hints.includes('model')) values.model = 'SM-S916N';
          if (hints.includes('uaFullVersion')) values.uaFullVersion = '142.0.7444.171';
          if (hints.includes('fullVersionList')) {
            values.fullVersionList = [
              { brand: 'Chromium', version: '142.0.7444.171' },
              { brand: 'Google Chrome', version: '142.0.7444.171' },
              { brand: 'Not_A Brand', version: '99.0.0.0' },
            ];
          }
          if (hints.includes('wow64')) values.wow64 = false;
          if (hints.includes('formFactors')) values.formFactors = ['Mobile'];
          // 디버그: Client Hints 호출 로그
          console.log('[ClientHints] getHighEntropyValues 호출:', hints, '-> 반환:', values);
          return values;
        },
        toJSON: () => ({
          brands: [
            { brand: 'Chromium', version: '142' },
            { brand: 'Google Chrome', version: '142' },
            { brand: 'Not_A Brand', version: '99' },
          ],
          mobile: true,
          platform: 'Android',
        }),
      };
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => userAgentData,
        configurable: true,
      });

      // 3. deviceMemory (S23+: 8GB)
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
      });

      // 4. hardwareConcurrency (S23+: 8코어)
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });

      // 5. maxTouchPoints (S23+: 5)
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 5,
        configurable: true,
      });

      // 6. connection (Network Information API)
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          downlink: 3.95,
          rtt: 100,
          saveData: false,
        }),
        configurable: true,
      });

      // 7. plugins (모바일: 빈 배열)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [],
        configurable: true,
      });

      // 8. pdfViewerEnabled (모바일: false)
      Object.defineProperty(navigator, 'pdfViewerEnabled', {
        get: () => false,
        configurable: true,
      });
    });

    log('[1] navigator 오버라이드 설정 완료');
  }

  /**
   * 모든 요청에 Client Hints 헤더 강제 적용
   * 리다이렉트 시에도 브라우저가 헤더를 덮어쓰지 않도록 route interceptor 사용
   */
  private async setupDomainHeaders(): Promise<void> {
    if (!this.page) return;

    await this.page.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();

      // 이미지, 폰트, 스타일시트는 빠르게 통과
      if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
        await route.continue();
        return;
      }

      // 기존 헤더 + Client Hints 강제 적용 (S23+ 실제 기기 값)
      const headers: Record<string, string> = {
        ...request.headers(),
        // 핵심 헤더 (Core Headers)
        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'accept-language': 'ko-KR,ko;q=0.9',
        // 확장 헤더 (Extended Headers) - S23+ 실제 기기 값
        'sec-ch-ua-platform-version': '"16.0.0"',
        'sec-ch-ua-model': '"SM-S916N"',
        'sec-ch-ua-full-version-list': '"Chromium";v="142.0.7444.171", "Google Chrome";v="142.0.7444.171", "Not_A Brand";v="99.0.0.0"',
        'sec-ch-ua-arch': '""',
        'sec-ch-ua-bitness': '""',
        'sec-ch-ua-form-factors': '"Mobile"',
        'sec-ch-ua-wow64': '?0',
      };

      // document 요청에는 sec-fetch-* 헤더 추가
      if (resourceType === 'document') {
        headers['sec-fetch-dest'] = 'document';
        headers['sec-fetch-mode'] = 'navigate';
        headers['sec-fetch-user'] = '?1';
        headers['upgrade-insecure-requests'] = '1';

        // sec-fetch-site 계산
        const referer = request.headers()['referer'] || '';
        if (referer) {
          const refHost = new URL(referer).hostname;
          const reqHost = new URL(request.url()).hostname;
          if (refHost === reqHost) {
            headers['sec-fetch-site'] = 'same-origin';
          } else if (refHost.endsWith('naver.com') && reqHost.endsWith('naver.com')) {
            headers['sec-fetch-site'] = 'same-site';
          } else {
            headers['sec-fetch-site'] = 'cross-site';
          }
        } else {
          headers['sec-fetch-site'] = 'none';
        }
      }

      await route.continue({ headers });
    });

    log('[1] 도메인별 헤더 설정 완료 (route interceptor)');
  }

  /**
   * VPN IP 체크 - 서버 IP와 같으면 종료
   * @returns true면 VPN 정상, false면 서버 IP (종료 필요)
   */
  async checkVpnIp(): Promise<boolean> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[IP] VPN IP 체크 중...');
    await this.page.goto(IP_CHECK.URL, { waitUntil: 'load' });

    // 페이지에서 IP 텍스트 추출
    const ipText = await this.page.locator('body').textContent();
    const ip = ipText?.trim() || '';
    this.currentIp = ip;  // 클래스 멤버에 저장

    log(`[IP] 현재 IP: ${ip}`);
    log(`[IP] 서버 IP: ${IP_CHECK.SERVER_IP}`);

    if (ip === IP_CHECK.SERVER_IP) {
      log('[IP] ⚠️ VPN 연결 안 됨! 서버 IP로 접속 중 - 종료합니다.');
      return false;
    }

    log('[IP] ✓ VPN 정상 연결');
    return true;
  }

  /**
   * 네이버 메인 페이지 접근
   */
  async goToMain(): Promise<string> {
    if (!this.page || !this.context) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[2] 네이버 메인 접근 중...');
    // domcontentloaded로 빠르게 진행 (networkidle 대기 제거)
    await this.page.goto(NAVER_URLS.MAIN, { waitUntil: 'domcontentloaded' });

    // 검색창이 보이면 바로 진행
    await this.page.waitForSelector('#MM_SEARCH_FAKE', {
      state: 'visible',
      timeout: SEARCH_CONFIG.TIMEOUT.ELEMENT_WAIT,
    });
    log('[2] 검색창 확인 - 진행');

    await this.saveHtml('01_main');

    // NNB 쿠키 확인 및 저장 (필수) - VPN은 느릴 수 있으므로 대기
    let nnbCookie = null;
    const maxWait = 10000;  // 최대 10초 대기
    const checkInterval = 500;  // 0.5초마다 확인
    let waited = 0;

    while (!nnbCookie && waited < maxWait) {
      const cookies = await this.context.cookies();
      nnbCookie = cookies.find(c => c.name === 'NNB');

      if (!nnbCookie) {
        log(`[2] NNB 쿠키 대기 중... (${waited}ms)`);
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        waited += checkInterval;
      }
    }

    if (!nnbCookie) {
      log('[2] ⚠️ NNB 쿠키가 생성되지 않음! (10초 대기 후 실패)');
      throw new Error('NNB 쿠키 생성 실패');
    }

    // 오리지널 NNB 저장 (추적용)
    this.issuedNnb = nnbCookie.value;
    log(`[2] NNB 쿠키 발급 (오리지널): ${nnbCookie.value}`);
    await this.saveNnbCookie(nnbCookie.value);

    // NNB 풀링: 조건에 맞는 기존 NNB가 있으면 교체
    const pooledNnb = await this.selectPooledNnb();
    if (pooledNnb) {
      await this.applyPooledNnb(pooledNnb);
      this.usedNnb = pooledNnb;
      log(`[2] ★ NNB 교체됨: ${nnbCookie.value} → ${pooledNnb} (풀링)`);
      return pooledNnb;  // 풀링된 NNB 반환
    }

    // 풀에 사용 가능한 NNB 없으면 오리지널 사용
    this.usedNnb = nnbCookie.value;
    log(`[2] NNB 사용: ${nnbCookie.value} (오리지널 - 풀 없음)`);
    return nnbCookie.value;
  }

  /**
   * 통합검색 실행
   * @param keyword 검색어
   * @param nnb NNB 쿠키 값 (사용량 증가용)
   */
  async search(keyword: string, nnb: string): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log(`[3] 통합검색 실행: "${keyword}"`);

    // 1. 가짜 검색창 클릭 → 실제 검색창 활성화
    const fakeSearchInput = this.page.locator('#MM_SEARCH_FAKE');
    await fakeSearchInput.click();

    // 2. 실제 검색 input이 나타날 때까지 대기
    const searchInput = this.page.locator('input#query');
    await searchInput.waitFor({ state: 'visible', timeout: SEARCH_CONFIG.TIMEOUT.ELEMENT_WAIT });
    log('[3] 검색창 활성화');

    // 3. 검색어 입력 (한 글자씩 자연스럽게)
    await searchInput.pressSequentially(keyword, { delay: randomBetween(100, 200) });
    log('[3] 검색어 입력 완료');

    await this.delay(randomBetween(500, 1000));

    // 4. 검색 실행
    await searchInput.press('Enter');
    await this.page.waitForLoadState('domcontentloaded');
    await this.saveHtml('02_search_result');

    // 5. 쿠키 확인
    await this.logCookies();

    // 6. NNB 사용량 증가 (검색 1회 = +1)
    await this.incrementNnbUsage(nnb);

    log('[3] 통합검색 완료');
  }

  /**
   * 쿠키 정보 로그 출력 (key와 value 일부분)
   */
  private async logCookies(): Promise<void> {
    if (!this.context) return;

    const cookies = await this.context.cookies();
    log(`[COOKIE] 총 ${cookies.length}개 쿠키 할당됨`);

    // 주요 쿠키만 표시 (네이버 관련)
    const naverCookies = cookies.filter(c =>
      c.domain.includes('naver') || c.name.startsWith('NNB') || c.name.startsWith('nx')
    );

    naverCookies.slice(0, 10).forEach(c => {
      const valuePreview = c.value.length > 20
        ? c.value.substring(0, 20) + '...'
        : c.value;
      log(`[COOKIE] ${c.name}=${valuePreview} (${c.domain})`);
    });

    if (naverCookies.length > 10) {
      log(`[COOKIE] ... 외 ${naverCookies.length - 10}개`);
    }

    // NNB 쿠키 DB 저장
    const nnbCookie = cookies.find(c => c.name === 'NNB');
    if (nnbCookie) {
      await this.saveNnbCookie(nnbCookie.value);
    }
  }

  /**
   * 최종 쿠키 확인 (저장 직전 NNB 검증)
   */
  private async verifyFinalCookies(): Promise<void> {
    if (!this.context) return;

    const cookies = await this.context.cookies();
    const nnbCookie = cookies.find(c => c.name === 'NNB');

    log('[FINAL] ═══════════════════════════════════════');
    log(`[FINAL] 최종 쿠키 검증`);

    if (nnbCookie) {
      const currentNnb = nnbCookie.value;
      const isPooled = this.issuedNnb !== this.usedNnb;
      const isCorrect = currentNnb === this.usedNnb;

      log(`[FINAL] 발급 NNB: ${this.issuedNnb}`);
      log(`[FINAL] 사용 NNB: ${this.usedNnb}${isPooled ? ' (풀링됨)' : ' (오리지널)'}`);
      log(`[FINAL] 현재 NNB: ${currentNnb}`);

      if (isCorrect) {
        log(`[FINAL] ✅ NNB 정상 적용됨`);
      } else {
        log(`[FINAL] ⚠️ NNB 불일치! 예상: ${this.usedNnb}, 실제: ${currentNnb}`);
      }
    } else {
      log(`[FINAL] ❌ NNB 쿠키 없음!`);
    }

    log('[FINAL] ═══════════════════════════════════════');
  }

  /**
   * NNB 쿠키를 DB에 저장 (신규 생성 시 use_count=0)
   * 현재 사용 횟수도 조회해서 로그 출력
   */
  private async saveNnbCookie(nnb: string): Promise<void> {
    try {
      const conn = await mysql.createConnection(DB_CONFIG);

      // 먼저 현재 상태 조회
      const [rows] = await conn.execute(
        `SELECT use_count, created_at FROM nnb_cookies WHERE nnb = ?`,
        [nnb]
      ) as any;

      if (rows.length > 0) {
        const { use_count, created_at } = rows[0];
        log(`[DB] NNB 쿠키 기존: ${nnb} (사용횟수: ${use_count}, 생성: ${created_at})`);
      } else {
        log(`[DB] NNB 쿠키 신규: ${nnb}`);
      }

      // INSERT OR UPDATE
      await conn.execute(
        `INSERT INTO nnb_cookies (nnb, use_count, created_at, called_at, last_used_at)
         VALUES (?, 0, NOW(), NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           called_at = NOW()`,
        [nnb]
      );
      await conn.end();
    } catch (err) {
      log(`[DB] NNB 저장 실패: ${err}`);
    }
  }

  /**
   * NNB 사용량 증가 (검색 시 호출)
   */
  private async incrementNnbUsage(nnb: string): Promise<void> {
    try {
      const conn = await mysql.createConnection(DB_CONFIG);
      await conn.execute(
        `UPDATE nnb_cookies SET use_count = use_count + 1, last_used_at = NOW() WHERE nnb = ?`,
        [nnb]
      );
      await conn.end();
    } catch (err) {
      log(`[DB] NNB 사용량 증가 실패: ${err}`);
    }
  }

  /**
   * NNB 풀에서 사용 가능한 쿠키 선택
   * 조건:
   * - 1시간 이상 경과 (created_at)
   * - 사용횟수 5회 미만
   * - 3분 이내 미호출 (called_at)
   *
   * @returns 선택된 NNB 또는 null (없으면 오리지널 사용)
   */
  private async selectPooledNnb(): Promise<string | null> {
    try {
      const conn = await mysql.createConnection(DB_CONFIG);

      // 조건에 맞는 NNB 랜덤 선택 (ORDER BY RAND())
      const [rows] = await conn.execute(
        `SELECT nnb, use_count, created_at, called_at
         FROM nnb_cookies
         WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
           AND use_count < 5
           AND (called_at IS NULL OR called_at < DATE_SUB(NOW(), INTERVAL 3 MINUTE))
         ORDER BY RAND()
         LIMIT 1`
      ) as any;

      if (rows.length > 0) {
        const { nnb, use_count, created_at, called_at } = rows[0];
        log(`[DB] NNB 풀 랜덤 선택: ${nnb} (사용: ${use_count}회, 생성: ${created_at}, 마지막호출: ${called_at})`);

        // called_at 업데이트 (선점)
        await conn.execute(
          `UPDATE nnb_cookies SET called_at = NOW() WHERE nnb = ?`,
          [nnb]
        );

        await conn.end();
        return nnb;
      }

      await conn.end();
      log('[DB] NNB 풀에서 사용 가능한 쿠키 없음 → 오리지널 NNB 사용');
      return null;
    } catch (err) {
      log(`[DB] NNB 풀 선택 실패: ${err}`);
      return null;
    }
  }

  /**
   * 브라우저 쿠키에 풀링된 NNB 적용
   * @param nnb 적용할 NNB 쿠키 값
   */
  private async applyPooledNnb(nnb: string): Promise<void> {
    if (!this.context) return;

    try {
      // 기존 NNB 쿠키 삭제
      const cookies = await this.context.cookies();
      const existingNnb = cookies.find(c => c.name === 'NNB');

      if (existingNnb) {
        log(`[NNB] 기존 쿠키 교체: ${existingNnb.value} → ${nnb}`);
      }

      // 새 NNB 쿠키 설정
      await this.context.addCookies([{
        name: 'NNB',
        value: nnb,
        domain: '.naver.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,  // 1년
      }]);

      log(`[NNB] 풀링된 쿠키 적용 완료: ${nnb}`);
    } catch (err) {
      log(`[NNB] 쿠키 적용 실패: ${err}`);
    }
  }

  /**
   * 검색 로그 DB 저장
   * 테이블 자동 생성 후 로그 기록
   */
  private async saveSearchLog(
    keyword: string,
    success: boolean,
    rank?: number,
    productName?: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      const conn = await mysql.createConnection(DB_CONFIG);

      // 테이블 없으면 생성 (issued_nnb, used_nnb 컬럼 포함)
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS search_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          keyword VARCHAR(255) NOT NULL,
          product_name VARCHAR(255),
          ip VARCHAR(45),
          vpn_dongle INT,
          success BOOLEAN NOT NULL,
          rank_position INT,
          error_message TEXT,
          session_id VARCHAR(50),
          issued_nnb VARCHAR(50),
          used_nnb VARCHAR(50),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_keyword (keyword),
          INDEX idx_created_at (created_at),
          INDEX idx_success (success),
          INDEX idx_used_nnb (used_nnb)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      // 기존 테이블에 컬럼 없으면 추가 (마이그레이션)
      try {
        await conn.execute(`ALTER TABLE search_logs ADD COLUMN issued_nnb VARCHAR(50) AFTER session_id`);
      } catch (e) { /* 이미 존재 */ }
      try {
        await conn.execute(`ALTER TABLE search_logs ADD COLUMN used_nnb VARCHAR(50) AFTER issued_nnb`);
      } catch (e) { /* 이미 존재 */ }
      try {
        await conn.execute(`ALTER TABLE search_logs ADD INDEX idx_used_nnb (used_nnb)`);
      } catch (e) { /* 이미 존재 */ }

      // 로그 삽입 (NNB 정보 포함)
      await conn.execute(
        `INSERT INTO search_logs
         (keyword, product_name, ip, vpn_dongle, success, rank_position, error_message, session_id, issued_nnb, used_nnb)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          keyword,
          productName || null,
          this.currentIp || null,
          this.vpnDongle || null,
          success,
          rank || null,
          errorMessage || null,
          this.sessionId,
          this.issuedNnb || null,
          this.usedNnb || null,
        ]
      );

      await conn.end();
      const nnbInfo = this.issuedNnb !== this.usedNnb ? ` [NNB: ${this.usedNnb} (풀링)]` : '';
      log(`[DB] 검색 로그 저장: ${keyword} - ${success ? '성공' : '실패'}${nnbInfo}`);
    } catch (err) {
      log(`[DB] 검색 로그 저장 실패: ${err}`);
    }
  }

  /**
   * 네트워크 인터셉트 설정 (모든 요청/응답 status 로깅)
   */
  setupNetworkInterceptor(): void {
    if (!this.page) return;

    // 요청 로깅 (이미지, 폰트, js, css 제외)
    this.page.on('request', (request) => {
      const url = request.url();
      // 불필요한 리소스 제외 (이미지, 폰트, JS, CSS)
      if (!url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)(\?|$)/i)) {
        networkLogs.push({
          timestamp: getKSTTimestamp(),
          method: request.method(),
          url: url.substring(0, 200),  // URL 길이 제한
          type: 'request',
        });
      }
    });

    // 응답 로깅 (이미지, 폰트, js, css 제외)
    this.page.on('response', (response) => {
      const url = response.url();
      // 불필요한 리소스 제외 (이미지, 폰트, JS, CSS)
      if (!url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)(\?|$)/i)) {
        networkLogs.push({
          timestamp: getKSTTimestamp(),
          method: response.request().method(),
          url: url.substring(0, 200),
          status: response.status(),
          statusText: response.statusText(),
          type: 'response',
        });
      }
    });

    log('[NETWORK] 네트워크 로깅 활성화');
  }

  /**
   * 네트워크 로그 저장
   */
  private saveNetworkLog(): void {
    const filename = `${this.sessionId}_network.json`;
    const filepath = path.join(DEBUG_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(networkLogs, null, 2), 'utf-8');
    log(`[DEBUG] 네트워크 로그 저장: ${filename} (${networkLogs.length}개)`);
  }

  /**
   * 검색 결과 페이지에서 자연스럽게 스크롤하며 상품 탐색
   * scroll.ts 모듈 사용 (HAR 분석 기반 개선된 스크롤)
   */
  async browseSearchResults(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    // log('[4] 검색 결과 탐색 시작...');

    // HAR: 검색 후 약 1.7초 대기 (first 이벤트 발생)
    await this.delay(randomBetween(1500, 2000));

    // 스크롤 시퀀스 실행 (scroll.ts 모듈)
    await executeScrollSequence(
      this.page,
      SEARCH_RESULT_SCROLL_SEQUENCE,
      // (msg) => log(`[4] ${msg}`)
    );

    await this.saveHtml('03_after_browse');
    // log('[4] 검색 결과 탐색 완료');
  }

  /**
   * 요소에 시각적 하이라이트 표시 (안쪽 테두리)
   */
  private async highlightElement(selector: string, label: string): Promise<void> {
    if (!this.page) return;

    await this.page.evaluate(({ sel, lbl }) => {
      const el = document.querySelector(sel);
      if (!el) return;

      // 기존 하이라이트 제거
      document.querySelectorAll('.debug-highlight').forEach(e => e.remove());

      // 안쪽 하이라이트 오버레이 생성
      const rect = el.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.className = 'debug-highlight';
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top + 4}px;
        left: ${rect.left + 4}px;
        width: ${rect.width - 8}px;
        height: ${rect.height - 8}px;
        border: 3px solid #FF0000;
        background: rgba(255, 0, 0, 0.15);
        pointer-events: none;
        z-index: 99999;
        box-sizing: border-box;
      `;

      // 라벨 표시
      const labelEl = document.createElement('div');
      labelEl.className = 'debug-highlight';
      labelEl.style.cssText = `
        position: fixed;
        top: ${rect.top + 8}px;
        left: ${rect.left + 8}px;
        background: #FF0000;
        color: white;
        padding: 4px 8px;
        font-size: 12px;
        font-weight: bold;
        z-index: 100000;
        border-radius: 4px;
      `;
      labelEl.textContent = lbl;

      document.body.appendChild(overlay);
      document.body.appendChild(labelEl);
    }, { sel: selector, lbl: label });
  }

  /**
   * nv_mid로 요소에 하이라이트 표시
   */
  private async highlightByNvMid(nvMid: string, isAd: boolean): Promise<void> {
    if (!this.page) return;

    await this.page.evaluate(({ mid, ad }) => {
      // 기존 하이라이트 제거
      document.querySelectorAll('.debug-highlight').forEach(e => e.remove());

      // nv_mid가 포함된 링크 찾기
      const link = document.querySelector(`a[href*="nv_mid=${mid}"]`);
      if (!link) return;

      // 상위 컨테이너 찾기 (부모들 중 적절한 크기의 div)
      let container: Element | null = link;
      let parent = link.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          container = parent;
          break;
        }
        parent = parent.parentElement;
      }

      const rect = container.getBoundingClientRect();
      const color = ad ? '#FFA500' : '#00FF00'; // 광고: 주황, 일반: 녹색
      const label = ad ? `광고 (${mid})` : `일반상품 (${mid})`;

      // 안쪽 하이라이트
      const overlay = document.createElement('div');
      overlay.className = 'debug-highlight';
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top + 4}px;
        left: ${rect.left + 4}px;
        width: ${rect.width - 8}px;
        height: ${rect.height - 8}px;
        border: 3px solid ${color};
        background: ${color}33;
        pointer-events: none;
        z-index: 99999;
        box-sizing: border-box;
      `;

      // 라벨
      const labelEl = document.createElement('div');
      labelEl.className = 'debug-highlight';
      labelEl.style.cssText = `
        position: fixed;
        top: ${rect.top + 8}px;
        left: ${rect.left + 8}px;
        background: ${color};
        color: ${ad ? 'black' : 'black'};
        padding: 4px 8px;
        font-size: 11px;
        font-weight: bold;
        z-index: 100000;
        border-radius: 4px;
      `;
      labelEl.textContent = label;

      document.body.appendChild(overlay);
      document.body.appendChild(labelEl);
    }, { mid: nvMid, ad: isAd });
  }

  /**
   * 타겟 상품 클릭 (nv_mid=88214130348 고정)
   */
  async clickTargetProduct(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    const TARGET_NV_MID = TARGET_PRODUCT.nv_mid;
    log(`[5] 타겟 상품 찾는 중... (nv_mid=${TARGET_NV_MID})`);

    try {
      // nv_mid=88214130348 포함 링크 찾기
      const targetLink = this.page.locator(`a[href*="nv_mid=${TARGET_NV_MID}"]`).first();
      const isVisible = await targetLink.isVisible().catch(() => false);

      if (!isVisible) {
        log('[5] 타겟 상품이 화면에 없음 - 스크롤하며 찾기...');

        // 스크롤하면서 찾기
        for (let i = 0; i < 5; i++) {
          await naturalScroll(this.page, randomBetween(400, 600));
          await this.delay(randomBetween(1000, 1500));

          const found = await targetLink.isVisible().catch(() => false);
          if (found) {
            log(`[5] 타겟 상품 발견 (${i + 1}번째 스크롤)`);
            break;
          }
        }
      }

      // 다시 확인
      const href = await targetLink.getAttribute('href').catch(() => null);
      if (!href) {
        log('[5] ⚠️ 타겟 상품을 찾을 수 없음');
        await this.saveHtml('05_target_not_found');
        return;
      }

      log(`[5] 타겟 상품 발견: ${href.substring(0, 100)}...`);

      // 자연스럽게 스크롤
      await this.scrollToProductNaturally(TARGET_NV_MID);
      await this.delay(randomBetween(500, 1000));

      // 하이라이트
      await this.highlightByNvMid(TARGET_NV_MID, false);
      await this.saveHtml('05_before_click');

      log('[5] ★ 상품 클릭 시도...');

      // 클릭 전 쿠키 로그
      await this.logCookies();

      // 클릭 후 네트워크 요청 집중 모니터링 설정
      const clickNetworkLogs: Array<{
        timestamp: string;
        type: 'req' | 'res';
        method: string;
        url: string;
        status?: number;
        statusText?: string;
      }> = [];

      const onRequest = (request: any) => {
        const url = request.url();
        // 이미지, 폰트, JS, CSS 제외
        if (!url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)($|\?)/i)
            && !url.match(/\/js\/|\/css\/|\.chunk\./i)) {
          const headers = request.headers();
          const entry: any = {
            timestamp: getKSTTimestamp(),
            type: 'req',
            method: request.method(),
            url: url.substring(0, 200),
          };

          // 메인 문서 요청 (네비게이션)만 상세 로그
          if (request.isNavigationRequest()) {
            entry.headers = headers;
            entry.isNavigation = true;
            log(`[REQ] ${request.method()} ${url.substring(0, 100)}...`);
          }

          clickNetworkLogs.push(entry);
        }
      };

      const onResponse = (response: any) => {
        const url = response.url();
        // 이미지, 폰트, JS, CSS 제외
        if (!url.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|js|css)($|\?)/i)
            && !url.match(/\/js\/|\/css\/|\.chunk\./i)) {
          const status = response.status();
          const headers = response.headers();
          const entry: any = {
            timestamp: getKSTTimestamp(),
            type: 'res',
            method: response.request().method(),
            url: url.substring(0, 200),
            status,
            statusText: response.statusText(),
          };

          // 주요 응답이면 헤더 기록
          if (url.includes('smartstore') || url.includes('shopping.naver') || status >= 400) {
            entry.responseHeaders = headers;
          }

          clickNetworkLogs.push(entry);

          // 중요: 4xx, 5xx 응답 즉시 로그
          if (status >= 400) {
            log(`[RES] ⚠️ HTTP ${status} ${response.statusText()}: ${url.substring(0, 80)}...`);
          }
        }
      };

      (this.page as any).on('request', onRequest);
      (this.page as any).on('response', onResponse);

      // 클릭!
      await targetLink.click();
      log('[5] 클릭 완료 - 페이지 로딩 대기...');

      // 페이지 완전 로드 대기 (30초 타임아웃, 타임아웃 시에도 계속 진행)
      try {
        await this.page.waitForLoadState('load', { timeout: 30000 });
        log('[5] 페이지 로드 완료');
      } catch {
        log('[5] 페이지 로드 타임아웃 (30초) - 현재 상태로 판단');
      }

      // 리스너 제거
      (this.page as any).off('request', onRequest);
      (this.page as any).off('response', onResponse);

      // 클릭 후 네트워크 로그 출력 (js, css, 이미지, 폰트 제외)
      const filteredLogs = clickNetworkLogs.filter((entry) => {
        const url = entry.url || '';
        // 확장자 또는 /js/, /css/ 경로 패턴으로 필터링
        return !url.match(/\.(js|css|png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot)($|\?)/i)
          && !url.match(/\/js\/|\/css\/|\.chunk\./i);
      });
      log(`[5] 클릭 후 네트워크 요청: ${filteredLogs.length}개 (필터링됨, 원본: ${clickNetworkLogs.length}개)`);
      filteredLogs.forEach((entry) => {
        if (entry.type === 'res') {
          const statusIcon = entry.status && entry.status >= 400 ? '❌' : '✓';
          log(`[NET] ${statusIcon} ${entry.status} ${entry.method} ${entry.url}`);
        }
      });

      // 클릭 후 네트워크 로그 별도 저장
      const clickNetworkFile = path.join(
        DEBUG_DIR,
        `${this.sessionId}_click_network.json`
      );
      fs.writeFileSync(clickNetworkFile, JSON.stringify(clickNetworkLogs, null, 2));
      log(`[DEBUG] 클릭 후 네트워크 로그 저장: ${path.basename(clickNetworkFile)}`);

      // 현재 URL 로그
      const currentUrl = this.page.url();
      log(`[5] 현재 URL: ${currentUrl}`);

      // 네트워크가 안정될 때까지 추가 대기 (JS 렌더링 완료 대기)
      log('[5] 네트워크 안정화 대기 중...');
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        log('[5] 네트워크 안정화 완료');
      } catch {
        log('[5] 네트워크 안정화 타임아웃 (10초)');
      }

      // 추가 2초 대기 (React hydration 완료 대기)
      await this.page.waitForTimeout(2000);

      // 결과 저장 (모든 렌더링 완료 후)
      await this.saveHtml('06_after_click');

      // 차단 체크: innerText로 직접 확인 (가장 확실한 방법)
      log('[5] 차단 여부 확인 중...');
      const bodyText = await this.page.locator('body').innerText();

      // 디버그: 페이지 텍스트 일부 출력
      const textPreview = bodyText.substring(0, 300).replace(/\n/g, ' ');
      log(`[5] 페이지 텍스트 미리보기: ${textPreview}...`);

      const isBlocked = bodyText.includes('상품이 존재하지 않습니다') ||
                        bodyText.includes('이전 페이지로 가기') ||
                        bodyText.includes('삭제되었거나 변경') ||
                        bodyText.includes('요청하신 페이지를 찾을 수 없습니다');

      if (isBlocked) {
        log('[5] ════════════════════════════════════════');
        log('[5] ⚠️ 차단 페이지 감지됨!');
        log('[5] ════════════════════════════════════════');

        // 차단 분석 정보 출력
        log(`[차단분석] IP: ${this.currentIp || 'unknown'}`);
        log(`[차단분석] VPN 동글: ${this.vpnDongle || 'none'}`);
        log(`[차단분석] 세션 ID: ${this.sessionId}`);

        // 현재 쿠키 정보
        if (this.context) {
          const cookies = await this.context.cookies();
          const nnbCookie = cookies.find(c => c.name === 'NNB');
          if (nnbCookie) {
            log(`[차단분석] NNB 쿠키: ${nnbCookie.value}`);
          }
          log(`[차단분석] 총 쿠키 수: ${cookies.length}개`);
        }

        // 클릭 네트워크 요약
        const errorResponses = clickNetworkLogs.filter((e: any) => e.type === 'res' && e.status >= 400);
        if (errorResponses.length > 0) {
          log(`[차단분석] 에러 응답: ${errorResponses.length}개`);
          errorResponses.forEach((e: any) => {
            log(`[차단분석]   ${e.status} ${e.url}`);
          });
        } else {
          log(`[차단분석] 에러 응답: 없음 (모두 200 OK)`);
        }

        log('[5] ════════════════════════════════════════');
        throw new Error('상품 페이지 차단됨');
      }

      log(`[5] ✓ 상품 페이지 정상 로드 확인`);

      // 네트워크 로그 저장
      this.saveNetworkLog();

    } catch (e) {
      log(`[5] 상품 클릭 실패: ${e}`);
      await this.saveHtml('05_click_error');
      this.saveNetworkLog();
      throw e;  // 에러를 다시 던져서 runOnce에서 실패 처리
    }
  }

  /**
   * 타겟 상품으로 자연스럽게 스크롤 (scrollIntoViewIfNeeded 대체)
   * - 정확한 중앙 배치 대신 "대략적인 위치"로 자연스럽게 이동
   * - 여러 번의 작은 스크롤로 접근 (실제 사용자 패턴)
   * - 랜덤하게 "오버슈트" 패턴 사용 (타겟을 지나쳤다가 올라오기)
   */
  private async scrollToProductNaturally(nvMid: string): Promise<void> {
    if (!this.page) return;

    const viewport = this.page.viewportSize();
    if (!viewport) return;

    // 타겟 요소의 현재 위치 확인
    const targetRect = await this.page.evaluate((mid) => {
      const link = document.querySelector(`a[href*="nv_mid=${mid}"]`);
      if (!link) return null;
      const rect = link.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        centerY: rect.top + rect.height / 2,
      };
    }, nvMid);

    if (!targetRect) {
      log('[5] 타겟 요소를 찾을 수 없음');
      return;
    }

    // 고정 헤더 영역 계산 (스크롤 후 기준)
    // - 스크롤 전: 120px (검색창 + 탭)
    // - 스크롤 후: 72px (검색창만)
    const STICKY_HEADER_HEIGHT = 72;

    // 클릭 가능한 영역의 중앙 계산 (고정 헤더 제외)
    const visibleTop = STICKY_HEADER_HEIGHT;
    const visibleHeight = viewport.height - STICKY_HEADER_HEIGHT;
    const visibleCenter = visibleTop + visibleHeight / 2;

    // 약간의 랜덤 오프셋 추가 (정확한 중앙 회피)
    const targetOffset = randomBetween(-60, 60);
    const desiredPosition = visibleCenter + targetOffset;

    // 현재 위치와 목표 위치의 차이
    const scrollDistance = targetRect.centerY - desiredPosition;

    // 이미 화면에 적당히 보이더라도 "탐색하는 척" 미세 스크롤 수행
    // (검색 → 즉시 클릭 패턴은 봇으로 의심받을 수 있음)
    if (Math.abs(scrollDistance) < 100) {
      log('[5] 타겟이 화면에 보이지만 자연스러운 탐색 스크롤 수행');

      // 위로 살짝 갔다가 다시 내려오는 패턴 (실제 사용자처럼)
      const exploreUp = randomBetween(150, 300);
      await naturalScroll(this.page, -exploreUp);  // 위로
      await this.delay(randomBetween(500, 1000));

      await naturalScroll(this.page, exploreUp + randomBetween(50, 150));  // 다시 아래로
      await this.delay(randomBetween(300, 600));
      return;
    }

    log(`[5] 타겟으로 자연스럽게 스크롤 (거리: ${Math.round(scrollDistance)}px)`);

    // 30% 확률로 "오버슈트" 패턴 사용 (타겟을 지나쳤다가 올라오기)
    const useOvershoot = Math.random() < 0.3 && scrollDistance > 200;

    if (useOvershoot) {
      log('[5] 오버슈트 패턴 사용 (타겟 지나쳤다가 올라오기)');

      // 타겟보다 200~400px 더 아래로 스크롤
      const overshootExtra = randomBetween(200, 400);
      const overshootDistance = scrollDistance + overshootExtra;

      // 1. 먼저 오버슈트 (타겟을 지나침)
      const overshootScrollCount = randomBetween(2, 3);
      const perOvershoot = overshootDistance / overshootScrollCount;

      for (let i = 0; i < overshootScrollCount; i++) {
        const jitter = randomBetween(-30, 30);
        await naturalScroll(this.page, perOvershoot + jitter);
        await this.delay(randomBetween(300, 600));
      }

      // 2. 잠시 머무르며 "어디갔지?" 느낌
      await this.delay(randomBetween(500, 1000));

      // 3. 다시 위로 올라와서 타겟 찾기
      log('[5] 위로 올라오며 타겟 찾기');
      const comeBackDistance = -overshootExtra - randomBetween(50, 150);
      await naturalScroll(this.page, comeBackDistance);
      await this.delay(randomBetween(300, 500));

    } else {
      // 일반 패턴: 여러 번의 스크롤로 나눠서 접근
      const scrollCount = Math.abs(scrollDistance) > 500 ? randomBetween(2, 3) : 1;
      const perScrollDistance = scrollDistance / scrollCount;

      for (let i = 0; i < scrollCount; i++) {
        // 각 스크롤마다 약간의 변동 추가
        const jitter = randomBetween(-30, 30);
        const thisScroll = perScrollDistance + jitter;

        // scroll.ts의 naturalScroll 사용 (첫 번째만 디버그)
        await naturalScroll(this.page, thisScroll);

        // 스크롤 사이 자연스러운 대기
        if (i < scrollCount - 1) {
          await this.delay(randomBetween(400, 800));
        }
      }
    }

    // 최종 위치 안정화 대기
    await this.delay(randomBetween(300, 600));
  }

  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * VPN 토글 상태 파일 읽기
   * @returns 동글별 마지막 토글 시간 (timestamp)
   */
  private readVpnToggleState(): Record<string, number> {
    try {
      if (fs.existsSync(VPN_TOGGLE_STATE_FILE)) {
        const data = fs.readFileSync(VPN_TOGGLE_STATE_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch (e) {
      log(`[VPN] 토글 상태 파일 읽기 실패: ${e}`);
    }
    return {};
  }

  /**
   * VPN 토글 상태 파일 저장
   * @param state 동글별 마지막 토글 시간
   */
  private saveVpnToggleState(state: Record<string, number>): void {
    try {
      fs.writeFileSync(VPN_TOGGLE_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) {
      log(`[VPN] 토글 상태 파일 저장 실패: ${e}`);
    }
  }

  /**
   * VPN 토글 쿨다운 대기 시간 계산
   * @returns 추가로 대기해야 할 시간 (ms), 0이면 대기 불필요
   */
  private getVpnToggleCooldownWait(): number {
    const state = this.readVpnToggleState();
    const dongleKey = `vpn_${VPN_DONGLE}`;
    const lastToggle = state[dongleKey] || 0;

    if (lastToggle === 0) {
      return 0;  // 이전 기록 없음
    }

    const now = Date.now();
    const elapsed = now - lastToggle;
    const cooldownMs = VPN_TOGGLE_COOLDOWN_SECONDS * 1000;

    if (elapsed >= cooldownMs) {
      return 0;  // 쿨다운 완료
    }

    return cooldownMs - elapsed;  // 남은 대기 시간
  }

  /**
   * VPN 토글 시간 기록
   */
  private recordVpnToggle(): void {
    const state = this.readVpnToggleState();
    const dongleKey = `vpn_${VPN_DONGLE}`;
    state[dongleKey] = Date.now();
    this.saveVpnToggleState(state);
  }

  /**
   * VPN IP 토글 (다음 실행 시 새 IP 사용)
   * 쿨다운: 최소 30초 간격 유지
   */
  private async toggleVpnIp(): Promise<void> {
    // 쿨다운 체크 및 대기
    const cooldownWait = this.getVpnToggleCooldownWait();
    if (cooldownWait > 0) {
      const waitSeconds = Math.ceil(cooldownWait / 1000);
      log(`[VPN] 쿨다운 대기 중... (${waitSeconds}초 후 토글 가능)`);
      await new Promise(resolve => setTimeout(resolve, cooldownWait));
    }

    const toggleUrl = `${VPN_TOGGLE.BASE_URL}/${VPN_DONGLE}`;
    try {
      log(`[VPN] IP 변경 요청 중... (동글 ${VPN_DONGLE})`);
      const response = await fetch(toggleUrl);

      // 성공/실패 무관하게 토글 시간 기록 (모뎀 보호 목적)
      this.recordVpnToggle();

      if (response.ok) {
        log('[VPN] ✓ IP 변경 완료');
      } else {
        log(`[VPN] ⚠️ IP 변경 실패: ${response.status}`);
      }
    } catch (e) {
      // 실패해도 토글 시간 기록 (모뎀 보호 목적)
      this.recordVpnToggle();
      log(`[VPN] ⚠️ IP 변경 요청 실패: ${e}`);
    }
  }

  /**
   * 브라우저 종료
   */
  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
        log('[END] 브라우저 종료');
      } catch (e) {
        log('[END] 브라우저 이미 종료됨');
      }
      this.context = null;
      this.page = null;
    }

    // Lock 파일 정리 (다음 실행을 위해)
    this.cleanBrowserLocks();

    this.saveLog();
  }

  /**
   * 브라우저 lock 파일 정리
   */
  private cleanBrowserLocks(): void {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lockFile of lockFiles) {
      const lockPath = path.join(USER_DATA_DIR, lockFile);
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
        }
      } catch (e) {
        // 무시
      }
    }
  }

  /**
   * 메인 실행 플로우 (단일 실행)
   * @returns true: 성공, false: 실패
   */
  async runOnce(keyword: string): Promise<boolean> {
    // 클래스 멤버에 저장
    this.keyword = keyword;
    this.vpnDongle = VPN_DONGLE;

    try {
      await this.init();

      // VPN 모드일 때만 IP 체크
      if (USE_VPN) {
        const isVpnOk = await this.checkVpnIp();
        if (!isVpnOk) {
          await this.saveSearchLog(keyword, false, undefined, undefined, 'VPN 연결 안 됨');
          await this.close();
          return false;
        }
      }

      // 네트워크 로깅 시작
      this.setupNetworkInterceptor();

      // 메인 플로우
      const nnb = await this.goToMain();
      await this.search(keyword, nnb);
      await this.browseSearchResults();
      await this.clickTargetProduct();

      log('[DONE] 작업 완료');

      // 최종 쿠키 확인 (NNB가 실제 사용되었는지 검증)
      await this.verifyFinalCookies();

      this.saveLog();

      // 성공 로그 저장
      await this.saveSearchLog(keyword, true);
      return true;

    } catch (error) {
      log(`[ERROR] ${error}`);
      await this.saveHtml('error');
      this.saveLog();

      // 실패 로그 저장
      await this.saveSearchLog(keyword, false, undefined, undefined, String(error));
      return false;
    }
  }

  /**
   * 메인 실행 (단일 또는 반복)
   */
  async run(_keyword: string): Promise<void> {
    // PARALLEL_MODE: --repeat=N 또는 --repeat=0 (forever) 처리
    const isForever = PARALLEL_MODE && REPEAT_COUNT === 0;
    const repeatCount = PARALLEL_MODE ? (REPEAT_COUNT || 1) : 1;

    log(`[DEBUG] REPEAT_MODE=${REPEAT_MODE}, PARALLEL_MODE=${PARALLEL_MODE}, REPEAT_COUNT=${REPEAT_COUNT}`);

    let successCount = 0;
    let failCount = 0;
    let round = 0;

    while (isForever || round < repeatCount) {
      round++;
      const keyword = getRandomKeyword();  // 매 라운드 새 키워드

      if (repeatCount > 1 || isForever) {
        const displayCount = isForever ? `#${round}` : `${round}/${repeatCount}`;
        log(`\n[ROUND] ========== ${displayCount} ==========`);
        log(`[ROUND] 키워드: ${keyword}`);
      }

      const success = await this.runOnce(keyword);

      if (success) {
        successCount++;
        log('[RESULT] ✅ 성공');
      } else {
        failCount++;
        log('[RESULT] ❌ 실패');
      }

      // VPN IP 토글 (매 라운드)
      if (USE_VPN) {
        await this.toggleVpnIp();
      }

      // 브라우저 종료 (다음 라운드를 위해)
      await this.close();

      // 다음 라운드 대기 (마지막 제외)
      if (isForever || round < repeatCount) {
        const delay = randomBetween(3000, 5000);
        log(`[ROUND] ${delay / 1000}초 대기 후 다음 라운드...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // 결과 요약
    if (repeatCount > 1) {
      const rate = Math.round((successCount / repeatCount) * 100);
      log(`\n[SUMMARY] ========== 완료 ==========`);
      log(`[SUMMARY] 📊 결과: 성공 ${successCount}회, 실패 ${failCount}회 (성공률 ${rate}%)`);
    }

    if (AUTO_EXIT_MODE) {
      log(`[AUTO] ${PARALLEL_MODE ? '병렬' : '반복'} 모드 - 자동 종료`);
      process.exit(failCount === repeatCount ? 1 : 0);
    } else {
      // 단일 모드: 종료 대기 (브라우저 열린 상태 유지)
      await this.waitForExit();
    }
  }

  /**
   * 브라우저 종료 또는 엔터 입력 대기
   */
  private async waitForExit(): Promise<void> {
    log('[EXIT] 브라우저를 닫거나 엔터를 누르면 종료됩니다.');

    return new Promise<void>((resolve) => {
      let resolved = false;

      const cleanup = async () => {
        if (resolved) return;
        resolved = true;
        rl.close();

        // VPN 모드일 때만 IP 토글
        if (USE_VPN) {
          await this.toggleVpnIp();
        }

        await this.close();
        resolve();
      };

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.on('line', async () => {
        log('[EXIT] 엔터 입력 - 종료합니다.');
        await cleanup();
        process.exit(0);
      });

      if (this.context) {
        this.context.on('close', async () => {
          log('[EXIT] 브라우저 종료 감지');
          await cleanup();
          process.exit(0);
        });
      }
    });
  }
}

// 실행
// 사용법:
//   npm start [--vpn=18]              : 단일 실행
//   npm start --repeat [--repeat=10]  : 반복 실행 (기본 10회)
//   npm start --repeat --delay=60     : 반복 간격 60초 (기본 30초)

/**
 * VPN 토글 쿨다운 대기 시간 계산 (마스터 프로세스용)
 * @param dongle VPN 동글 번호
 * @returns 추가로 대기해야 할 시간 (ms), 0이면 대기 불필요
 */
function getVpnToggleCooldownWaitForDongle(dongle: number): number {
  try {
    if (!fs.existsSync(VPN_TOGGLE_STATE_FILE)) {
      return 0;
    }
    const data = fs.readFileSync(VPN_TOGGLE_STATE_FILE, 'utf-8');
    const state = JSON.parse(data);
    const dongleKey = `vpn_${dongle}`;
    const lastToggle = state[dongleKey] || 0;

    if (lastToggle === 0) {
      return 0;
    }

    const now = Date.now();
    const elapsed = now - lastToggle;
    const cooldownMs = VPN_TOGGLE_COOLDOWN_SECONDS * 1000;

    if (elapsed >= cooldownMs) {
      return 0;
    }

    return cooldownMs - elapsed;
  } catch (e) {
    return 0;
  }
}

async function runRepeatMode() {
  // 세션 폴더 생성
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }
  log(`[REPEAT] 세션 폴더: ${DEBUG_DIR}`);

  const isForever = REPEAT_COUNT === 0;
  log(`[REPEAT] 반복 모드 시작 (${isForever ? '무한' : REPEAT_COUNT + '회'})`);
  log(`[REPEAT] 사용 VPN 동글: ${VPN_DONGLES.join(', ')}`);
  if (isForever) {
    log(`[REPEAT] Ctrl+C로 종료`);
  }

  let successCount = 0;
  let failCount = 0;
  let i = 0;

  while (isForever || i < REPEAT_COUNT) {
    // 랜덤 VPN 동글 선택
    const dongle = VPN_DONGLES[Math.floor(Math.random() * VPN_DONGLES.length)];
    const displayCount = isForever ? `#${i + 1}` : `${i + 1}/${REPEAT_COUNT}`;
    log(`\n[REPEAT] ========== ${displayCount} 회차 (VPN ${dongle}) ==========`);

    try {
      // 새 프로세스로 실행 (VPN 네임스페이스 적용을 위해)
      // --repeat, --session, --round 플래그 전달
      const { execSync } = require('child_process');
      const roundNum = i + 1;
      execSync(
        `sudo ./vpn/run-in-vpn.sh ${dongle} /home/tech/naver/shop/node_modules/.bin/ts-node src/index.ts --vpn=${dongle} --repeat --session=${SESSION_ID} --round=${roundNum}`,
        {
          cwd: '/home/tech/naver/shop',
          stdio: 'inherit',
          timeout: 120000,  // 2분 타임아웃
        }
      );
      successCount++;
      log(`[REPEAT] ✅ ${displayCount} 회차 성공 (VPN ${dongle})`);
    } catch (error: any) {
      failCount++;
      // exit code 1이면 정상적인 실패, 그 외는 에러
      const exitCode = error?.status;
      if (exitCode === 1) {
        log(`[REPEAT] ❌ ${displayCount} 회차 실패 (VPN ${dongle}) - 차단됨`);
      } else {
        log(`[REPEAT] ❌ ${displayCount} 회차 실패 (VPN ${dongle}) - 에러: ${error.message || error}`);
      }
    }

    i++;

    // 다음 회차 대기 (마지막 회차 제외, 무한 모드는 항상 대기)
    if (isForever || i < REPEAT_COUNT) {
      // 기본 3초 대기
      log(`[REPEAT] 기본 3초 대기...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 쿨다운 추가 대기 (30초 - 경과시간)
      const cooldownWait = getVpnToggleCooldownWaitForDongle(dongle);
      if (cooldownWait > 0) {
        const waitSeconds = Math.ceil(cooldownWait / 1000);
        log(`[REPEAT] VPN ${dongle} 쿨다운 추가 대기... (${waitSeconds}초)`);
        await new Promise(resolve => setTimeout(resolve, cooldownWait));
      }
    }
  }

  const rate = REPEAT_COUNT > 0 ? Math.round((successCount / REPEAT_COUNT) * 100) : 0;
  log(`\n[REPEAT] ========== 완료 ==========`);
  log(`[REPEAT] 📊 결과: 성공 ${successCount}회, 실패 ${failCount}회 (성공률 ${rate}%)`);

  // 마스터 로그 저장
  const masterLogPath = path.join(DEBUG_DIR, 'repeat.log');
  fs.writeFileSync(masterLogPath, logBuffer.join('\n'), 'utf-8');
  log(`[REPEAT] 로그 저장: ${masterLogPath}`);
}

// 메인 실행
if (IS_REPEAT_MASTER) {
  // 반복 모드 (마스터 프로세스)
  runRepeatMode();
} else {
  // 단일 실행 (또는 반복 모드의 자식 프로세스)
  // 매 실행마다 랜덤 키워드 생성 (필수: 달빛, 기정떡 + 추가 0~4개)
  const keyword = getRandomKeyword();
  new NaverShopSearcher().run(keyword);
}
