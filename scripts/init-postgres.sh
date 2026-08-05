#!/bin/bash
# Docker ilk başlatmada çalışır — örnek veritabanları oluşturur.
# Bu script'i ihtiyacınıza göre düzenleyin.

set -e

echo "Postgrify: initializing example databases..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Örnek proje veritabanları (isteğe göre silin veya ekleyin)
  CREATE DATABASE IF NOT EXISTS project1;
  CREATE DATABASE IF NOT EXISTS project2;
EOSQL

echo "Postgrify: initialization complete."