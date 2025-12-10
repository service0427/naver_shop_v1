# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

네이버 쇼핑 검색 자동화 도구 - Playwright를 사용하여 모바일 에뮬레이션 환경에서 네이버 쇼핑 검색을 자동화합니다.

## Commands

```bash
# 일반 실행 (VPN 없이)
npm start

# VPN 모드 실행 (동글 번호 지정)
npm run start:vpn        # 기본 동글 18번
npm run start:vpn:16     # 동글 16번
npm run start:vpn:17     # 동글 17번
# ... 23번까지

# 개발 모드 (핫 리로드)
npm run dev

# 빌드
npm run build
```

## Architecture

### Core Files

- `src/index.ts` - 메인 자동화 로직 (`NaverShopSearcher` 클래스)
- `src/config.ts` - 설정값 (디바이스 설정, URL, 타임아웃)
- `devices/s23plus_device_profile.json` - Samsung Galaxy S23+ 실제 기기 핑거프린트

### Automation Flow

1. 브라우저 초기화 (Samsung Galaxy S23+ 모바일 에뮬레이션)
2. 네이버 모바일 메인 (`m.naver.com`) 접근
3. 통합검색 실행
4. 검색 결과에서 쇼핑 영역 탐색
5. 쇼핑 영역 없으면 쇼핑 탭으로 이동

### Key Configuration

- 모바일 에뮬레이션: Samsung Galaxy S23+ SM-S916N (412x915, deviceScaleFactor: 2.8125)
- 브라우저: Chromium via patchright (headless: false, slowMo: 50)
- 타겟 URL: `m.naver.com`, `mshopping.naver.com`
- Client Hints: Chrome 142, Android 16, 다크모드

## Development Notes

- Playwright 브라우저 설치: `npx playwright install chromium`
- 테스트 상품명은 `config.ts`의 `SEARCH_CONFIG.TEST_PRODUCT`에서 수정
- 디버깅 시 `slowMo` 값 조정으로 실행 속도 제어 가능

## Policy

### 실행 환경 정책

- **headless 모드 사용 금지**: 항상 GUI 모드(`headless: false`)로 실행
- **VPN 필수**: `npm start`는 자동으로 VPN 네임스페이스에서 실행됨
- **IP 체크**: 시작 시 `mkt.techb.kr/ip`에서 IP 확인, 서버 IP면 즉시 종료

### 테스트 실행 정책

- **Claude는 직접 실행 금지**: `npm start`, `xvfb-run` 등 직접 실행하지 않음
- **사용자가 직접 실행**: GUI 터미널에서 사용자가 `npm start` 실행
- **피드백 기반 개발**: 사용자가 실행 후 결과(스크린샷, 로그, 에러)를 피드백하면 Claude가 코드 수정
- **VPN 환경 충돌 방지**: VPN 네임스페이스와 xvfb 조합 시 오류 발생 가능하므로 사용자 직접 실행 필수

### 개발 정책

- **파일 최소화**: 불필요한 파일 생성 금지, 새 파일 생성 시 사용자 허락 필요
- **하드코딩 우선**: 최초 개발 단계에서는 하드코딩으로 완성도를 높인 후 모듈화 진행
- **단일 실행**: `npm start` 하나로 실행, 테스트 파일 별도 생성 금지
- **디버깅 로그**: HTML 결과 최대 10개 유지, 콘솔 로그도 파일로 저장 (`debug/` 폴더)
