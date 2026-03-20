# Deploy через Docker + Nginx

## 1) Подготовка

1. Установите Docker и Docker Compose plugin.
2. Скопируйте `.env.example` в `.env` и заполните значения:
   - `PG_DSN`
   - `MONGO_URI`, `MONGO_DB`
   - `MONGO_AUTH_URI`, `MONGO_AUTH_DB` (если нужно)
   - `ACCESS_PASSWORD` (пароль входа на сайт)
   - `FLASK_SECRET_KEY` (случайный длинный ключ)
   - `SESSION_COOKIE_SECURE=true` (оставить `true` для HTTPS)

Пример генерации секретов (PowerShell):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 2) Запуск

```powershell
docker compose up -d --build
```

Проверка:

```powershell
docker compose ps
docker compose logs -f nginx
docker compose logs -f app
```

Сервис будет доступен на `http://<server-ip>/`.

## 3) Что уже защищено

- Приложение за reverse proxy (Nginx), Flask напрямую наружу не торчит.
- Ограничение частоты на `/api/auth/login` (rate limit).
- Security headers (`X-Frame-Options`, `CSP`, `nosniff` и др.).
- Ограничение размера тела запроса (`client_max_body_size`).
- Доступ к API закрыт до ввода пароля.

## 4) Рекомендации для production

- Поставить HTTPS (например, Nginx + certbot или внешний LB/Cloudflare).
- Открыть наружу только `80/443`, закрыть прямой доступ к Docker API.
- Включить firewall (UFW/SG) только с нужными портами.
- Регулярно обновлять образы:

```powershell
docker compose pull
docker compose up -d
```
