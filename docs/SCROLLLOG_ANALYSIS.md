# 네이버 ScrollLog 봇 탐지 분석 문서

> 최종 업데이트: 2025-12-08
> 분석 대상: `scrollLog_Controller_251030.js`

## 1. 개요

네이버는 `scrolllog` 시스템을 통해 사용자의 스크롤 행동을 추적합니다. 이 데이터는 다음 목적으로 사용됩니다:
- 광고 노출 측정 (viewability)
- 사용자 행동 분석 (UX 개선)
- **봇/자동화 탐지**

## 2. ScrollLog URL 구조

```
https://l.search.naver.com/n/scrolllog/v2?
  u={페이지URL}
  &q={검색어}
  &sscode={탭코드}
  &pg={페이지ID}
  &pn={페이지번호}
  &slogs={이벤트JSON배열}
  &EOU
```

## 3. 이벤트 타입 (`t`)

| 타입 | 설명 | 발생 시점 |
|------|------|----------|
| `first` | 페이지 첫 렌더링 | 검색 결과 로드 직후 |
| `change` | 뷰포트 영역 변경 | 스크롤로 새 영역 진입 시 |
| `expand` | 영역 확장 | 더 많은 콘텐츠가 뷰포트에 들어올 때 |
| `scroll` | 스크롤 이벤트 | 스크롤 동작 완료 시 |

### 이벤트 발생 순서 (정상 패턴)
```
first → change → expand → scroll → scroll → scroll → ...
```

## 4. 핵심 파라미터 상세

### 4.1. `pt` (Page Timestamp)

**스크롤 duration 측정의 핵심**

```javascript
// first, change, expand 이벤트
"pt": 1765183292730  // 단일 timestamp (밀리초)

// scroll 이벤트
"pt": "1765187336528:1765187338328"  // "시작:종료" 형식
```

| 분석 항목 | 계산 방법 | 봇 탐지 기준 |
|----------|----------|-------------|
| 스크롤 duration | 종료 - 시작 | 너무 짧거나 일정하면 의심 |
| 이벤트 간격 | 현재 시작 - 이전 종료 | 너무 규칙적이면 의심 |

**실제 사용자 통계:**
- duration 범위: 445ms ~ 6526ms
- duration 평균: 1528ms
- 이벤트 간격: 934ms ~ 6882ms

### 4.2. `tsi` (Total Scroll Info)

**전체 스크롤 상태 추적**

```javascript
"tsi": "11767:562:1477"
//      문서높이:현재Y:누적스크롤
```

| 필드 | 설명 | 봇 탐지 포인트 |
|------|------|---------------|
| 문서 높이 | 페이지 전체 높이 (px) | 변경 없이 스크롤만 하면 의심 |
| 현재 Y | 현재 스크롤 위치 | 급격한 점프 감지 |
| 누적 스크롤 | 총 스크롤한 거리 | 스크롤 없이 이동하면 의심 |

**봇 탐지 패턴:**
```javascript
// 정상: 점진적 증가
"tsi": "11767:300:400"
"tsi": "11767:600:700"
"tsi": "11767:900:1100"

// 의심: 급격한 점프 (scrollIntoView 사용 시)
"tsi": "11767:300:400"
"tsi": "11767:2500:400"  // ⚠️ Y는 점프했는데 누적스크롤은 그대로
```

### 4.3. `si` (Scroll Info)

**뷰포트 정보**

```javascript
"si": "11192:701:384"
//     문서높이:뷰포트높이:뷰포트너비

// 스크롤 이벤트에서는 비어있을 수 있음
"si": ""
```

### 4.4. `al` (Area Log)

**영역별 노출 정보**

```javascript
"al": "pwl:121:1348:441:907|shp_fnd:1477:3049:0:0|shs_lis:4534:941:0:0"
```

파이프(`|`)로 구분된 영역 정보:
```
영역코드:offset:height:scrollStart:scrollEnd
```

| 영역 코드 | 설명 |
|----------|------|
| `pwl` | 파워링크 (광고) |
| `shp_fnd` | 쇼핑 파인드 |
| `shs_lis` | 쇼핑 리스트 |
| `opt` | 옵션 영역 |
| `web_gen` | 웹 일반 검색 |
| `ugB_*` | UGC 블록 |

**봇 탐지 포인트:**
- 영역이 렌더링되지 않은 상태에서 스크롤 → 의심
- scrollStart/scrollEnd가 비정상적 → 의심

### 4.5. `cl` (Component Log)

**개별 컴포넌트(상품) 노출 정보**

```javascript
"cl": "shp_fnd:nad-a001-02-000000426278611:1815:227:0:227:0:380:0:380"
```

구조:
```
영역:상품ID:top:height:viewStart:viewEnd:left:width:viewLeft:viewWidth
```

| 필드 | 설명 |
|------|------|
| 영역 | 소속 영역 코드 |
| 상품 ID | nv_mid 또는 광고 ID |
| top | 요소 상단 위치 |
| height | 요소 높이 |
| viewStart | 뷰포트 내 시작점 |
| viewEnd | 뷰포트 내 종료점 |
| left, width | 가로 위치/크기 |
| viewLeft, viewWidth | 뷰포트 내 가로 노출 |

**봇 탐지 포인트:**
- 상품이 화면에 없는데 클릭 → 의심
- viewStart/viewEnd가 0인데 클릭 → 의심

### 4.6. `sl` (Section Log)

**섹션 로그** - 대부분 비어있음

```javascript
"sl": ""
```

### 4.7. `r` (Reason)

**이벤트 발생 사유**

```javascript
"r": "change_after_area_change"
```

| 값 | 의미 |
|---|------|
| `change_after_area_change` | 영역 변경 후 change 이벤트 |
| (비어있음) | 일반 스크롤 |

## 5. 봇 탐지 취약점 및 대응

### 5.1. 스크롤 Duration (⚠️ 중요)

| 위험 요소 | 탐지 기준 | 대응 방법 |
|----------|----------|----------|
| 너무 짧은 duration | < 300ms | 최소 800ms 유지 |
| 일정한 duration | 표준편차 < 100ms | 가우시안 분포 적용 |
| 너무 긴 duration | > 10000ms | 최대 2000ms 제한 |

**구현:**
```typescript
// scroll.ts
DURATION: {
  MIN: 800,
  MAX: 2000,
  AVG: 1400,  // 가우시안 분포 중심
}
```

### 5.2. 스크롤 패턴 (⚠️ 중요)

| 위험 요소 | 탐지 기준 | 대응 방법 |
|----------|----------|----------|
| 일정한 간격 | 표준편차 < 500ms | 랜덤 대기 시간 |
| 일정한 거리 | 모든 스크롤 동일 | 거리 랜덤화 |
| 선형 스크롤 | 가속/감속 없음 | easing curve 적용 |

**구현:**
```typescript
// easing: sin 곡선 기반
const ease = Math.sin(progress * Math.PI);
const delta = (totalDist / steps) * (0.5 + ease * 0.8);
```

### 5.3. tsi 급변 (⚠️ 중요)

| 위험 요소 | 탐지 기준 | 대응 방법 |
|----------|----------|----------|
| Y 좌표 점프 | scrollIntoView 사용 | naturalScroll 사용 |
| 누적스크롤 불일치 | Y 변화량 ≠ 누적증가 | 실제 스크롤 이벤트만 사용 |

**구현:**
```typescript
// scrollToProductNaturally()
// scrollIntoViewIfNeeded() 대신 naturalScroll() 사용
await naturalScroll(this.page, thisScroll);
```

### 5.4. 영역/컴포넌트 노출 (중간 위험)

| 위험 요소 | 탐지 기준 | 대응 방법 |
|----------|----------|----------|
| 영역 미렌더링 | al이 비어있음 | 충분한 대기 시간 |
| 컴포넌트 미노출 | cl의 viewEnd = 0 | 실제 화면에 보일 때만 클릭 |

### 5.5. 이벤트 순서 (낮은 위험)

| 위험 요소 | 탐지 기준 | 대응 방법 |
|----------|----------|----------|
| first 누락 | 페이지 로드 후 first 없음 | 자동 발생 (브라우저가 트리거) |
| 순서 역전 | scroll 후 first | 자연스러운 흐름 유지 |

## 6. 현재 구현 상태

### 6.1. 구현된 대응 (✅)

- [x] 스크롤 duration 개선 (643ms → 1467ms 평균)
- [x] 가우시안 분포로 자연스러운 변동
- [x] sin easing curve 적용
- [x] scrollIntoViewIfNeeded → naturalScroll 대체
- [x] 랜덤 대기 시간
- [x] 스크롤 거리 랜덤화

### 6.2. 추가 개선 가능 (🔄)

- [ ] 중간 멈춤(pause) 패턴 추가
- [ ] 스크롤 방향 전환 패턴
- [ ] 터치 이벤트 시뮬레이션 (모바일)

## 7. 모니터링 체크리스트

스크롤 로직 업데이트 시 확인 사항:

```bash
# 1. scroll 이벤트 pt duration 확인
grep "scroll" debug/*.log | grep "pt"

# 2. tsi 변화량 확인 (급격한 점프 없는지)
# Y 좌표 변화량 ≈ 누적스크롤 증가량 이어야 함

# 3. 이벤트 순서 확인
# first → change → expand → scroll 순서 유지
```

## 8. 참고 자료

- 분석 대상 스크립트: `https://ssl.pstatic.net/sstatic/fe/sfe/scrollLog/Controller_251030.js`
- HAR 파일: `har/naver_마우스.har`
- 구현 코드: `src/scroll.ts`

---

> ⚠️ 이 문서는 봇 탐지 메커니즘 분석 결과입니다. 네이버 정책 변경 시 업데이트가 필요합니다.
