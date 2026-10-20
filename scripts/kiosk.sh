#!/bin/sh
# macOS 개발/테스트용 키오스크 실행 (현장은 Windows 가정, kiosk.cmd 참고)
URL="http://localhost:4175/?kiosk=1"
npm run preview &
sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --kiosk "$URL" \
  --use-fake-ui-for-media-stream \
  --autoplay-policy=no-user-gesture-required \
  --disable-session-crashed-bubble \
  --noerrdialogs \
  --user-data-dir="$HOME/.pubilla-mimic-codex-profile"
