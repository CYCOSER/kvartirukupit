# Квартирукупить

Сайт недвижимости Калининграда: каталог ЖК и квартир с картой, заявки, блог и админка. Поддерживает импорт из CRM RF39 и НМаркет, редактирование и локальное улучшение фотографий.

**Стек:** Nuxt 3 · Vue 3 · TypeScript · Tailwind CSS · Prisma · PostgreSQL 17 · Leaflet.

## Запуск на Linux

Нужны Git, Docker с Compose v2 и доступ к приватному репозиторию.

```bash
git clone https://github.com/CYCOSER/kvartirukupit.git
cd kvartirukupit
cp .env.example .env
```

Задайте в `.env`:

- `POSTGRES_PASSWORD` — случайный пароль из букв и цифр.
- `ADMIN_EMAIL` — email администратора.
- `ADMIN_PASSWORD` — уникальный пароль от 16 символов вместо заглушки.

```bash
mkdir -p .data/nmarket
sudo chown 1000:1000 .data/nmarket
docker compose up -d --build
```

Первая сборка скачивает зависимости и модель улучшения фото. Для сервиса обработки выделены 2 CPU и до 4 ГБ RAM; сайту и БД нужны дополнительные ресурсы.

- **Сайт:** [localhost:3100](http://localhost:3100)
- **Админка:** [вход](http://localhost:3100/admin-console-9Xk6uiIs/login)

Миграции, создание администратора и начальное наполнение выполняются автоматически. Изменение `ADMIN_PASSWORD` в `.env` не меняет пароль уже созданного администратора.

## Настройки

Все параметры — в [`.env.example`](.env.example). Для импорта задайте `NUXT_RF39_TOKEN` и/или `NUXT_NMARKET_FEED_URL`; для первого запуска они не нужны. Импортированные объекты создаются как черновики.

Для публикации настройте обратный прокси с HTTPS, укажите домен в `NUXT_PUBLIC_SITE_URL`, включите `COOKIE_SECURE=true` и заполните контакты и реквизиты. Compose открывает порт только на `127.0.0.1`; URL должен совпадать с адресом сайта.

## Обновление

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web
```

БД, фотографии и выгрузка RF39 хранятся в Docker volumes, выгрузка НМаркет — в `.data/nmarket/`. Для резервной копии сохраняйте их вместе с `.env`. Команда `docker compose down -v` удаляет volumes.

## Проверки

На Linux с Node.js 22+:

```bash
npm ci
npm run db:generate
npm run typecheck
npm test
npm run build
```

Браузерные тесты: `npx playwright install --with-deps chromium && npm run test:e2e`. Нужен запущенный сайт с тестовой БД и администратором из `.env`; тесты создают и удаляют временные данные.

[Конфигурация Docker](compose.yaml) · [Команды npm](package.json) · [Обработка фотографий](services/upscale/README.md)
