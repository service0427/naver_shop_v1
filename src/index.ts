import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { MOBILE_DEVICE, NAVER_URLS, SEARCH_CONFIG, EXTRA_HEADERS } from './config';

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
   */
  async init(): Promise<void> {
    log('[1] 브라우저 초기화 중...');

    this.browser = await chromium.launch({
      headless: false, // GUI 모드
      slowMo: 100,     // 동작을 천천히 (디버깅용)
    });

    this.context = await this.browser.newContext({
      ...MOBILE_DEVICE,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      extraHTTPHeaders: EXTRA_HEADERS,
    });

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(SEARCH_CONFIG.TIMEOUT.PAGE_LOAD);

    log('[1] 브라우저 초기화 완료 (모바일 모드)');
  }

  /**
   * 네이버 메인 페이지 접근
   */
  async goToMain(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[2] 네이버 메인 접근 중...');
    await this.page.goto(NAVER_URLS.MAIN, { waitUntil: 'load' });
    log('[2] load 완료');

    // 추가 네트워크 안정화 대기
    await this.page.waitForLoadState('networkidle');
    log('[2] networkidle 완료');

    // 검색창(#MM_SEARCH_FAKE)이 나타날 때까지 대기
    await this.page.waitForSelector('#MM_SEARCH_FAKE', {
      state: 'visible',
      timeout: SEARCH_CONFIG.TIMEOUT.ELEMENT_WAIT,
    });
    log('[2] 검색창 요소 확인');

    // 페이지 렌더링 안정화를 위한 추가 대기
    await this.delay(1000);

    await this.saveHtml('01_main');
    log('[2] 네이버 메인 접근 완료');
  }

  /**
   * 통합검색 실행
   */
  async search(keyword: string): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log(`[3] 통합검색 실행: "${keyword}"`);

    // 1. 가짜 검색창(#MM_SEARCH_FAKE) 클릭 -> 헤더가 header_fixed_in 으로 변경됨
    const fakeSearchInput = this.page.locator('#MM_SEARCH_FAKE');
    await fakeSearchInput.click();

    // 2. 검색창 활성화 대기 (body.sch_focus)
    await this.page.waitForSelector('body.sch_focus', {
      timeout: SEARCH_CONFIG.TIMEOUT.ELEMENT_WAIT,
    });
    log('[3] 검색창 활성화 확인');

    // 3. 실제 검색창(#query)에 검색어 입력
    const realSearchInput = this.page.locator('input#query');
    await realSearchInput.fill(keyword);
    await this.delay(500);

    // 4. 검색 실행 (엔터키)
    await realSearchInput.press('Enter');
    await this.page.waitForLoadState('domcontentloaded');
    await this.saveHtml('02_search_result');

    log('[3] 통합검색 완료');
  }

  /**
   * 네트워크 인터셉트 설정 (scrolllog 요청 감시)
   */
  setupNetworkInterceptor(): void {
    if (!this.page) return;

    this.page.on('request', (request) => {
      const url = request.url();
      if (url.includes('scrolllog')) {
        log(`[NETWORK] scrolllog 요청 감지:`);
        log(`[NETWORK] ${url}`);
      }
    });

    log('[NETWORK] 네트워크 인터셉터 설정 완료');
  }

  /**
   * 랜덤 범위 값 생성
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 자연스러운 스크롤 (사람처럼 천천히)
   */
  private async naturalScroll(distance: number): Promise<void> {
    if (!this.page) return;

    const steps = this.randomBetween(3, 6);
    const stepDistance = distance / steps;

    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, stepDistance);
      // 각 스텝 사이에 자연스러운 딜레이 (50~150ms)
      await this.delay(this.randomBetween(50, 150));
    }
  }

  /**
   * 검색 결과 페이지에서 자연스럽게 스크롤하며 상품 탐색
   */
  async browseSearchResults(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[4] 검색 결과 탐색 시작...');

    // 페이지 로드 후 잠시 대기 (사람이 결과를 보는 시간)
    await this.delay(this.randomBetween(800, 1500));

    // 첫 번째 스크롤: 쇼핑 영역이 보이도록
    log('[4] 첫 번째 스크롤...');
    await this.naturalScroll(this.randomBetween(300, 500));
    await this.delay(this.randomBetween(500, 1000));

    // 두 번째 스크롤: 더 아래로
    log('[4] 두 번째 스크롤...');
    await this.naturalScroll(this.randomBetween(400, 600));
    await this.delay(this.randomBetween(600, 1200));

    // 세 번째 스크롤: 상품 목록 더 보기
    log('[4] 세 번째 스크롤...');
    await this.naturalScroll(this.randomBetween(300, 500));
    await this.delay(this.randomBetween(400, 800));

    // 잠시 멈춤 (상품 살펴보는 시간)
    log('[4] 상품 살펴보는 중...');
    await this.delay(this.randomBetween(1000, 2000));

    // 위로 살짝 스크롤 (다시 확인하는 동작)
    log('[4] 위로 살짝 스크롤...');
    await this.naturalScroll(this.randomBetween(-200, -100));
    await this.delay(this.randomBetween(500, 1000));

    await this.saveHtml('03_after_browse');
    log('[4] 검색 결과 탐색 완료');
  }

  /**
   * 광고가 아닌 일반 상품 클릭
   */
  async clickNonAdProduct(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[5] 일반 상품 찾는 중 (광고 제외)...');

    // 쇼핑 영역에서 광고가 아닌 상품 찾기
    // nad-a001 로 시작하는 것은 광고, 00000009_ 로 시작하는 것은 일반 상품
    const productItems = this.page.locator('[class*="product_item"], [class*="shopping_list"] a, [data-nclick*="shp"]');

    try {
      const count = await productItems.count();
      log(`[5] 발견된 상품 수: ${count}`);

      if (count === 0) {
        log('[5] 상품을 찾을 수 없습니다.');
        return;
      }

      // 상품들 중에서 광고가 아닌 것 찾기
      for (let i = 0; i < Math.min(count, 20); i++) {
        const item = productItems.nth(i);
        const href = await item.getAttribute('href');
        const dataLog = await item.getAttribute('data-nclick');

        // 광고 판별: nad-a001 이 포함되어 있으면 광고
        const isAd = href?.includes('nad-a001') ||
                     dataLog?.includes('nad-a001') ||
                     href?.includes('adcr.naver.com');

        if (!isAd && href) {
          log(`[5] 일반 상품 발견 (${i}번째): ${href.substring(0, 80)}...`);

          // 상품으로 스크롤
          await item.scrollIntoViewIfNeeded();
          await this.delay(this.randomBetween(300, 600));

          // 클릭 전 HTML 저장
          await this.saveHtml('04_before_product_click');

          // 상품 클릭
          await item.click();
          log('[5] 상품 클릭 완료');

          // 페이지 로드 대기
          await this.page.waitForLoadState('domcontentloaded');
          await this.saveHtml('05_product_page');

          return;
        }
      }

      log('[5] 광고가 아닌 상품을 찾지 못했습니다.');

    } catch (e) {
      log(`[5] 상품 클릭 실패: ${e}`);
      await this.saveHtml('05_click_error');
    }
  }

  /**
   * "네이버 가격비교 더보기" 링크로 이동
   */
  async goToShoppingMore(): Promise<void> {
    if (!this.page) throw new Error('브라우저가 초기화되지 않았습니다.');

    log('[5] "네이버 가격비교 더보기" 링크 찾는 중...');

    const moreLink = this.page.locator('a:has-text("네이버 가격비교 더보기")');

    try {
      await moreLink.scrollIntoViewIfNeeded();
      await this.delay(this.randomBetween(300, 600));

      await moreLink.waitFor({ timeout: SEARCH_CONFIG.TIMEOUT.ELEMENT_WAIT });
      log('[5] 링크 발견 - 클릭 시도');

      await this.saveHtml('05_before_more_click');

      await moreLink.click();
      log('[5] 클릭 완료');

      await this.page.waitForLoadState('domcontentloaded');
      await this.saveHtml('06_shopping_page');

      log('[5] 쇼핑 페이지 이동 완료');
    } catch (e) {
      log(`[5] 링크 클릭 실패: ${e}`);
      await this.saveHtml('05_click_error');
    }
  }

  /**
   * 지연 함수
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
   */
  async run(productName: string): Promise<void> {
    try {
      await this.init();

      // 네트워크 인터셉터 설정
      this.setupNetworkInterceptor();

      await this.goToMain();
      await this.search(productName);

      // 자연스러운 스크롤로 검색 결과 탐색
      await this.browseSearchResults();

      // "네이버 가격비교 더보기" 클릭하여 쇼핑 페이지로 이동
      await this.goToShoppingMore();

      log('[DONE] 작업 완료 - 브라우저를 닫거나 엔터를 누르면 종료됩니다.');
      this.saveLog();

      // 브라우저 종료 또는 엔터 입력 대기
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

      rl.on('line', () => {
        log('[EXIT] 엔터 입력 감지 - 종료합니다.');
        cleanup();
        this.close().then(() => process.exit(0));
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
const searcher = new NaverShopSearcher();
searcher.run(SEARCH_CONFIG.TEST_PRODUCT);
