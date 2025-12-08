import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { MOBILE_DEVICE, NAVER_URLS, SEARCH_CONFIG, EXTRA_HEADERS, IP_CHECK, VPN_TOGGLE } from './config';
import {
  executeScrollSequence,
  SEARCH_RESULT_SCROLL_SEQUENCE,
  randomBetween,
  naturalScroll,
} from './scroll';
import { getWeightedRandomKeyword } from './keywords';

// 실행 모드
// - 'gui': 기본 모드 (VPN + GUI 터미널에서 실행)
// - 'cdp': 기존 브라우저에 CDP로 연결 (--cdp ws://localhost:9222/...)
const RUN_MODE = process.argv.includes('--cdp') ? 'cdp' : 'gui';

// CDP 연결 URL (--cdp-url 옵션으로 지정)
const CDP_URL = process.argv.find(arg => arg.startsWith('--cdp-url='))?.split('=')[1]
  || 'http://localhost:9222';

// VPN 동글 번호 (--vpn=16 형태로 지정, 기본값 18)
const VPN_DONGLE_ARG = process.argv.find(arg => arg.startsWith('--vpn='))?.split('=')[1];
const VPN_DONGLE = VPN_DONGLE_ARG ? parseInt(VPN_DONGLE_ARG, 10) : VPN_TOGGLE.DEFAULT_DONGLE;

// 디버그 폴더 경로
const DEBUG_DIR = path.join(__dirname, '..', 'debug');
const MAX_DEBUG_FILES = 10;

// 로그 저장용 배열
const logBuffer: string[] = [];

// 콘솔 로그 래퍼
function log(message: string): void {
  const timestamp = new Date().toISOString();
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
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string;

  constructor() {
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-');
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
   * 브라우저 초기화 (모바일 에뮬레이션)
   * - gui 모드: 사용자가 직접 보면서 실행 (headless: false)
   * - remote 모드: xvfb에서 실행 (headless: false, but virtual display)
   * - cdp 모드: 기존 브라우저에 CDP로 연결 (9222 포트)
   */
  async init(): Promise<void> {
    log(`[1] 브라우저 초기화 중... (모드: ${RUN_MODE})`);

    if (RUN_MODE === 'cdp') {
      // CDP 모드: 기존 브라우저에 연결
      log(`[1] CDP 연결 시도: ${CDP_URL}`);
      this.browser = await chromium.connectOverCDP(CDP_URL);

      // 기존 컨텍스트 사용 또는 새로 생성
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
        const pages = this.context.pages();
        this.page = pages.length > 0 ? pages[0] : await this.context.newPage();
        log(`[1] 기존 컨텍스트 연결 (페이지: ${pages.length}개)`);
      } else {
        this.context = await this.browser.newContext({
          ...MOBILE_DEVICE,
          locale: 'ko-KR',
          timezoneId: 'Asia/Seoul',
          extraHTTPHeaders: EXTRA_HEADERS,
        });
        this.page = await this.context.newPage();
        log('[1] 새 컨텍스트 생성');
      }
    } else {
      // GUI 모드: 사용자가 직접 실행 (디버깅 포트 9222 활성화)
      this.browser = await chromium.launch({
        headless: false,
        slowMo: 100,
        args: [
          '--remote-debugging-port=9222',
          '--no-sandbox',
          '--disable-gpu',
          '--window-position=100,100',
          '--window-size=450,950',
        ],
      });
      this.context = await this.browser.newContext({
        ...MOBILE_DEVICE,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        extraHTTPHeaders: EXTRA_HEADERS,
      });
      this.page = await this.context.newPage();
    }

    this.page.setDefaultTimeout(SEARCH_CONFIG.TIMEOUT.PAGE_LOAD);

    // 창을 앞으로 가져오기
    await this.page.bringToFront();

    log(`[1] 브라우저 초기화 완료 (${RUN_MODE} 모드)`);
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
    const currentIp = await this.page.locator('body').textContent();
    const ip = currentIp?.trim() || '';

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
  async goToMain(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

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
  }

  /**
   * 통합검색 실행
   */
  async search(keyword: string): Promise<void> {
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
  }

  /**
   * 네트워크 인터셉트 설정 (scrolllog 요청 감시)
   */
  setupNetworkInterceptor(): void {
    if (!this.page) return;

    this.page.on('request', (request) => {
      const url = request.url();
      if (url.includes('scrolllog')) {
        // log(`[NETWORK] scrolllog 요청 감지:`);
        // log(`[NETWORK] ${url}`);
      }
    });

    // log('[NETWORK] 네트워크 인터셉터 설정 완료');
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
   * 쇼핑 영역에서 상품 탐색 (클릭하지 않고 시각적 표시만)
   */
  async clickShoppingProduct(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[5] 쇼핑 영역 상품 찾는 중...');

    try {
      // nv_mid가 포함된 링크 찾기
      const productLinks = this.page.locator('a[href*="nv_mid="]');
      const count = await productLinks.count();
      log(`[5] 발견된 상품 링크 (nv_mid): ${count}개`);

      if (count === 0) {
        log('[5] nv_mid 상품 링크를 찾을 수 없습니다.');
        return;
      }

      // 모든 상품 분석 및 표시
      let targetNvMid: string | null = null;
      let targetIsAd = false;

      for (let i = 0; i < Math.min(count, 15); i++) {
        const link = productLinks.nth(i);
        const href = await link.getAttribute('href');

        if (!href) continue;

        const nvMidMatch = href.match(/nv_mid=(\d+)/);
        const nvMid = nvMidMatch ? nvMidMatch[1] : null;

        if (!nvMid) continue;

        const isAd = href.includes('nad-a001') || href.includes('adcr.naver');
        log(`[5] 상품 ${i + 1}: nv_mid=${nvMid}, 광고=${isAd ? 'Y' : 'N'}`);

        // 첫 번째 일반 상품을 타겟으로 선택
        if (!targetNvMid && !isAd) {
          targetNvMid = nvMid;
          targetIsAd = false;
        }
      }

      // 일반 상품이 없으면 첫 번째 광고 선택
      if (!targetNvMid) {
        const firstHref = await productLinks.first().getAttribute('href');
        const match = firstHref?.match(/nv_mid=(\d+)/);
        targetNvMid = match ? match[1] : null;
        targetIsAd = true;
        log('[5] 일반 상품 없음, 첫 번째 광고 선택');
      }

      if (targetNvMid) {
        log(`[5] 타겟 상품: nv_mid=${targetNvMid} (${targetIsAd ? '광고' : '일반'})`);

        // 타겟 상품으로 자연스럽게 스크롤 (scrollIntoViewIfNeeded 대신)
        await this.scrollToProductNaturally(targetNvMid);

        // 시각적 하이라이트 표시
        await this.highlightByNvMid(targetNvMid, targetIsAd);
        log('[5] ★ 클릭 대상 하이라이트 완료 (클릭 비활성화 상태)');

        await this.saveHtml('05_target_highlighted');
      }

    } catch (e) {
      log(`[5] 상품 탐색 실패: ${e}`);
      await this.saveHtml('05_error');
    }
  }

  /**
   * 타겟 상품으로 자연스럽게 스크롤 (scrollIntoViewIfNeeded 대체)
   * - 정확한 중앙 배치 대신 "대략적인 위치"로 자연스럽게 이동
   * - 여러 번의 작은 스크롤로 접근 (실제 사용자 패턴)
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

    // 뷰포트 중앙 기준 (약간의 랜덤 오프셋 추가 - 정확한 중앙 회피)
    const viewportCenter = viewport.height / 2;
    const targetOffset = randomBetween(-80, 80); // 중앙에서 ±80px 오차
    const desiredPosition = viewportCenter + targetOffset;

    // 현재 위치와 목표 위치의 차이
    const scrollDistance = targetRect.centerY - desiredPosition;

    // 이미 화면에 적당히 보이면 스크롤 생략
    if (Math.abs(scrollDistance) < 100) {
      log('[5] 타겟이 이미 화면에 적절히 위치함');
      await this.delay(randomBetween(300, 600));
      return;
    }

    log(`[5] 타겟으로 자연스럽게 스크롤 (거리: ${Math.round(scrollDistance)}px)`);

    // 여러 번의 스크롤로 나눠서 접근 (큰 거리일 경우)
    const scrollCount = Math.abs(scrollDistance) > 500 ? randomBetween(2, 3) : 1;
    const perScrollDistance = scrollDistance / scrollCount;

    for (let i = 0; i < scrollCount; i++) {
      // 각 스크롤마다 약간의 변동 추가
      const jitter = randomBetween(-30, 30);
      const thisScroll = perScrollDistance + jitter;

      // scroll.ts의 naturalScroll 사용
      await naturalScroll(this.page, thisScroll);

      // 스크롤 사이 자연스러운 대기
      if (i < scrollCount - 1) {
        await this.delay(randomBetween(400, 800));
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
   * VPN IP 토글 (다음 실행 시 새 IP 사용)
   */
  private async toggleVpnIp(): Promise<void> {
    const toggleUrl = `${VPN_TOGGLE.BASE_URL}/${VPN_DONGLE}`;
    try {
      log(`[VPN] IP 변경 요청 중... (동글 ${VPN_DONGLE})`);
      const response = await fetch(toggleUrl);
      if (response.ok) {
        log('[VPN] ✓ IP 변경 완료');
      } else {
        log(`[VPN] ⚠️ IP 변경 실패: ${response.status}`);
      }
    } catch (e) {
      log(`[VPN] ⚠️ IP 변경 요청 실패: ${e}`);
    }
  }

  /**
   * 브라우저 종료
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      log('[END] 브라우저 종료');
    }
    this.saveLog();
  }

  /**
   * 메인 실행 플로우
   * @param keyword 검색어
   * @param searchOnly true면 검색까지만 (스크롤/클릭 생략)
   * @param skipIpCheck true면 IP 체크 건너뛰기 (테스트용)
   */
  async run(keyword: string, searchOnly = false, skipIpCheck = false): Promise<void> {
    try {
      await this.init();

      // VPN IP 체크 - 서버 IP면 즉시 종료
      if (!skipIpCheck) {
        const isVpnOk = await this.checkVpnIp();
        if (!isVpnOk) {
          await this.close();
          process.exit(1);
        }
      } else {
        log('[IP] ⚠️ IP 체크 건너뜀 (--skip-ip-check)');
      }

      // 네트워크 인터셉터 설정
      this.setupNetworkInterceptor();

      await this.goToMain();
      await this.search(keyword);

      if (searchOnly) {
        // 검색까지만 - 사용자가 수동으로 스크롤/클릭
        log('[DONE] 검색 완료 - 수동 테스트 모드');
        log('[DONE] 스크롤과 클릭은 직접 진행해주세요.');
      } else {
        // 자연스러운 스크롤로 검색 결과 탐색
        await this.browseSearchResults();

        // 쇼핑 영역 상품 클릭
        await this.clickShoppingProduct();

        log('[DONE] 작업 완료');
      }

      this.saveLog();

      // 브라우저 종료 또는 엔터 입력 대기
      log('[DONE] 브라우저를 닫거나 엔터를 누르면 종료됩니다.');
      await this.waitForExit();

    } catch (error) {
      log(`[ERROR] ${error}`);
      await this.saveHtml('error');
      this.saveLog();
      log('[ERROR] 에러 발생 - 브라우저를 닫거나 엔터를 누르면 종료됩니다.');

      // 에러 시에도 브라우저 종료 또는 엔터 입력 대기
      await this.waitForExit();
    }
  }

  /**
   * 브라우저 종료 또는 엔터 입력 대기
   */
  private async waitForExit(): Promise<void> {
    return new Promise<void>((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        rl.close();
        resolve();
      };

      // 엔터 키 입력 감지
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.on('line', async () => {
        log('[EXIT] 엔터 입력 감지 - VPN IP 변경 후 종료합니다.');
        cleanup();
        await this.toggleVpnIp();
        await this.close();
        process.exit(0);
      });

      // 브라우저 종료 감지
      if (this.browser) {
        this.browser.on('disconnected', () => {
          log('[EXIT] 브라우저 종료 감지 - 종료합니다.');
          cleanup();
          this.saveLog();
          process.exit(0);
        });
      }
    });
  }
}

// 실행
// --search-only: 검색까지만 (스크롤/클릭 생략, 수동 테스트용)
// --keyword "검색어": 특정 검색어로 검색 (지정 안 하면 랜덤)
// --skip-ip-check: IP 체크 건너뛰기 (테스트용)
const searchOnly = process.argv.includes('--search-only');
const skipIpCheck = process.argv.includes('--skip-ip-check');
const keywordArg = process.argv.find(arg => arg.startsWith('--keyword='));
const keyword = keywordArg ? keywordArg.split('=')[1] : getWeightedRandomKeyword();

const searcher = new NaverShopSearcher();
searcher.run(keyword, searchOnly, skipIpCheck);
