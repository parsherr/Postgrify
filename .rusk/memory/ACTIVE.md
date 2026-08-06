---
name: active
description: Şu anki görev durumu
metadata:
  type: project
---

# Now
Terminal panel implementasyonu tamamlandı.

# Done
- packages/.env oluşturuldu
- Setup wizard tamamlandı (GET /setup/status + POST /setup)
- Terminal panel: Quick SQL kaldırıldı, tab'lı terminal sistemi eklendi
  - API: @fastify/websocket + node-pty → routes/terminal.ts (WS PTY)
  - API: plugins/websocket.ts eklendi, plugins/index.ts güncellendi
  - GUI: @xterm/xterm + @xterm/addon-fit + @xterm/addon-web-links kuruldu
  - GUI: components/terminal/{terminalStore,ShellTerminal,SqlTerminal,TerminalPanel}.tsx
  - GUI: AppShell SidebarBottomPanel → TerminalPanel swap edildi
  - nginx.conf: /api/terminal/ WebSocket proxy eklendi
  - Dockerfile: node-pty için python3/make/g++ eklendi
- 215 test geçiyor

# Next
- docker compose up -d --build ile uçtan uca test
- Shell terminal: WS bağlantısı, PTY çıktısı, resize doğrulanacak
- SQL terminal: DB seçimi, sorgu çalıştırma doğrulanacak