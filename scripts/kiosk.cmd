@echo off
REM 윈도우 키오스크 실행: vite preview(4175) 를 띄운 뒤 Chrome 을 키오스크 모드로 연다.
REM 카메라 권한 프롬프트 생략: --use-fake-ui-for-media-stream
REM 자동재생/절전/업데이트 억제 플래그 포함. 경로는 현장 PC에 맞게 수정.
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
set URL=http://localhost:4175/?kiosk=1

start "pubilla-mimic-server" cmd /c "npm run preview"
timeout /t 3 /nobreak >nul

%CHROME% --kiosk %URL% ^
  --use-fake-ui-for-media-stream ^
  --autoplay-policy=no-user-gesture-required ^
  --disable-session-crashed-bubble ^
  --disable-infobars ^
  --noerrdialogs ^
  --disable-features=TranslateUI ^
  --overscroll-history-navigation=0 ^
  --disable-pinch ^
  --user-data-dir=%LOCALAPPDATA%\pubilla-mimic-codex-profile
