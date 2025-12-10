#!/bin/bash
#
# 4개 VPN 동글 병렬 실행 (단일 터미널)
# 마스터 프로세스가 4개 자식 프로세스를 관리
#
# 사용법:
#   sudo ./vpn/run-parallel.sh              # 4개 동글 동시 실행 (각 1회)
#   sudo ./vpn/run-parallel.sh 5            # 4개 동글 동시 실행 (각 5회 반복)
#   sudo ./vpn/run-parallel.sh forever      # 4개 동글 무한 반복
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DONGLES=(16 17 18 19)

# 반복 횟수 (기본값: 1회)
REPEAT="${1:-1}"

# 색상
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Root 권한 확인
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR]${NC} sudo로 실행하세요: sudo ./vpn/run-parallel.sh"
    exit 1
fi

# 원래 사용자 정보
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
REAL_UID=$(id -u "$REAL_USER")

echo -e "${GREEN}[PARALLEL]${NC} ========================================"
echo -e "${GREEN}[PARALLEL]${NC} 4개 VPN 동글 병렬 실행"
echo -e "${GREEN}[PARALLEL]${NC} 동글: ${DONGLES[*]}"
echo -e "${GREEN}[PARALLEL]${NC} 반복: $REPEAT"
echo -e "${GREEN}[PARALLEL]${NC} ========================================"
echo ""

# X 서버 접근 권한
if [ -n "$DISPLAY" ]; then
    xhost +local: >/dev/null 2>&1 || true
    xhost + >/dev/null 2>&1 || true
fi

# PID 저장 배열
declare -A PIDS

# 종료 시 모든 자식 프로세스 정리
cleanup() {
    echo ""
    echo -e "${YELLOW}[PARALLEL]${NC} 종료 중... 자식 프로세스 정리"
    for DONGLE in "${!PIDS[@]}"; do
        if kill -0 "${PIDS[$DONGLE]}" 2>/dev/null; then
            kill "${PIDS[$DONGLE]}" 2>/dev/null
            echo -e "${YELLOW}[VPN $DONGLE]${NC} 종료됨"
        fi
    done
    wait
    echo -e "${GREEN}[PARALLEL]${NC} 완료"
    exit 0
}
trap cleanup SIGINT SIGTERM

# 각 동글별로 백그라운드 실행
for DONGLE in "${DONGLES[@]}"; do
    NAMESPACE="vpn-$DONGLE"

    # 네임스페이스 확인
    if ! ip netns list | grep -q "^$NAMESPACE"; then
        echo -e "${RED}[VPN $DONGLE]${NC} 네임스페이스 없음 - 건너뜀"
        continue
    fi

    # 반복 옵션 설정
    if [ "$REPEAT" == "forever" ] || [ "$REPEAT" == "0" ]; then
        REPEAT_OPT="--repeat=0"
    elif [ "$REPEAT" -gt 1 ] 2>/dev/null; then
        REPEAT_OPT="--repeat=$REPEAT"
    else
        REPEAT_OPT=""
    fi

    echo -e "${CYAN}[VPN $DONGLE]${NC} 시작..."

    # VPN 네임스페이스에서 실행 (백그라운드)
    (
        cd "$PROJECT_DIR"
        XAUTH_FILE="${XAUTHORITY:-$REAL_HOME/.Xauthority}"
        NODE_BIN="$PROJECT_DIR/node_modules/.bin"

        ip netns exec "$NAMESPACE" \
            sudo -u "$REAL_USER" \
            env HOME="$REAL_HOME" \
            USER="$REAL_USER" \
            DISPLAY="${DISPLAY:-:0}" \
            XAUTHORITY="$XAUTH_FILE" \
            XDG_RUNTIME_DIR="/run/user/$REAL_UID" \
            PATH="$NODE_BIN:$PATH" \
            PLAYWRIGHT_BROWSERS_PATH="$REAL_HOME/.cache/ms-playwright" \
            ts-node src/index.ts --vpn=$DONGLE --parallel $REPEAT_OPT 2>&1 | \
            while IFS= read -r line; do
                echo -e "${CYAN}[VPN $DONGLE]${NC} $line"
            done
    ) &

    PIDS[$DONGLE]=$!
    sleep 1  # 시작 간격
done

echo ""
echo -e "${GREEN}[PARALLEL]${NC} ${#PIDS[@]}개 프로세스 실행 중 (Ctrl+C로 종료)"
echo ""

# 모든 자식 프로세스 대기
wait

echo ""
echo -e "${GREEN}[PARALLEL]${NC} 모든 프로세스 완료!"
