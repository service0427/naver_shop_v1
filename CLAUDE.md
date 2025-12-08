# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

네이버 쇼핑 검색 자동화 도구 - Playwright를 사용하여 모바일 에뮬레이션 환경에서 네이버 쇼핑 검색을 자동화합니다.

## Commands

```bash
# 개발 모드 (핫 리로드)
npm run dev

# 일반 실행
npm start

# 빌드
npm run build
```

## Architecture

### Core Files

- `src/index.ts` - 메인 자동화 로직 (`NaverShopSearcher` 클래스)
- `src/config.ts` - 설정값 (디바이스 설정, URL, 타임아웃)

### Automation Flow

1. 브라우저 초기화 (iPhone 12 Pro 모바일 에뮬레이션)
2. 네이버 모바일 메인 (`m.naver.com`) 접근
3. 통합검색 실행
4. 검색 결과에서 쇼핑 영역 탐색
5. 쇼핑 영역 없으면 쇼핑 탭으로 이동

### Key Configuration

- 모바일 에뮬레이션: iPhone 12 Pro (390x844, deviceScaleFactor: 3)
- 브라우저: Chromium (headless: false, slowMo: 100)
- 타겟 URL: `m.naver.com`, `mshopping.naver.com`

## Development Notes

- Playwright 브라우저 설치: `npx playwright install chromium`
- 테스트 상품명은 `config.ts`의 `SEARCH_CONFIG.TEST_PRODUCT`에서 수정
- 디버깅 시 `slowMo` 값 조정으로 실행 속도 제어 가능

## Policy

### 실행 환경 정책

- **headless 모드 사용 금지**: 항상 GUI 모드(`headless: false`)로 실행
- **사용자 직접 실행**: 스크립트는 사용자가 직접 구동하고 결과를 Claude에게 전달
- **xvfb 허용**: Claude의 개인 개발/테스트 용도로 xvfb 사용 가능
- **VPN**: 추후 VPN 연결 예정 (현재 단계에서는 미적용)

### 개발 정책

- **파일 최소화**: 불필요한 파일 생성 금지, 새 파일 생성 시 사용자 허락 필요
- **하드코딩 우선**: 최초 개발 단계에서는 하드코딩으로 완성도를 높인 후 모듈화 진행
- **단일 실행**: `npm start` 하나로 실행, 테스트 파일 별도 생성 금지
- **디버깅 로그**: HTML 결과 최대 10개 유지, 콘솔 로그도 파일로 저장 (`debug/` 폴더)
