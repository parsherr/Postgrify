#!/bin/sh
# Backup dizinini oluştur ve izinleri düzelt.
# Bind mount veya named volume olabilir; her iki durumda da yazılabilir yapar.
mkdir -p /data/backups
chmod 777 /data/backups 2>/dev/null || true

# postgrify kullanıcısına geç ve uygulamayı başlat
exec su-exec postgrify node dist/index.js