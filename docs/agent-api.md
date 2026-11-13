# API для ИИ-агента

Базовый адрес: `https://ваш-домен/api/agent/v1`. API управляет статьями блога и описаниями существующих ЖК и квартир. Полная схема OpenAPI доступна без авторизации по `https://ваш-домен/agent-openapi.json` ([файл в репозитории](../public/agent-openapi.json)) — её можно передать агенту или импортировать в клиент API.

## Подключение

1. Создайте секрет на сервере:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

2. Сохраните результат в серверном `.env`: `NUXT_AGENT_API_TOKEN=полученный_секрет`, затем выполните `docker compose build web` и `docker compose up -d --no-build web`. Минимум — 32 печатных ASCII-символа без пробелов. Пустое значение отключает API.
3. Передайте агенту базовый HTTPS-адрес, OpenAPI и токен через его хранилище секретов. Каждый запрос к API требует `Authorization: Bearer <token>`. Cookie и вход в админку не нужны.

Токен даёт доступ к черновикам и опубликованным статьям, обложкам и описаниям объектов. Он не разрешает менять цены, удалять объекты, работать с заявками или запускать импорт. Для отзыва замените или очистите переменную и пересоздайте контейнер `web`. Не помещайте токен в URL, браузерный код или репозиторий.

## Операции

Все пути ниже указаны относительно базового адреса. Идентификаторы `id` берутся из ответов списка или создания; это не `slug`.

| Метод и путь | Действие |
| --- | --- |
| `GET /articles` | Поиск и список статей, включая черновики |
| `POST /articles` | Создать статью; по умолчанию черновик |
| `GET /articles/{id}` | Получить статью целиком |
| `PATCH /articles/{id}` | Изменить только переданные поля |
| `DELETE /articles/{id}` | Удалить статью без корзины; ответ `{"ok":true}` |
| `POST /articles/{id}/image` | Загрузить/заменить обложку: multipart-поле `file` |
| `DELETE /articles/{id}/image` | Удалить обложку; ответ `{"ok":true}` |
| `GET /properties` | Поиск и список объектов |
| `GET /properties/{id}` | Получить описание и характеристики объекта |
| `PATCH /properties/{id}/description` | Задать описание: `{"description":"Текст"}` |
| `DELETE /properties/{id}/description` | Очистить описание, сохранив сам объект |

Списки возвращают `{items, total, limit, offset}`. Параметры: `limit` — 1–100 (по умолчанию 20), `offset` — 0–2147483647 (по умолчанию 0), `q` — поиск до 200 символов, `slug` — точный адрес, `published=true|false`. У объектов также доступен `type=complex|apartment`. Неизвестные параметры отклоняются. Обходите страницы, увеличивая `offset` на `limit`; полный текст статьи запрашивайте отдельно.

## Поля и публикация

При создании статьи обязательны `title` (3–150 символов), `slug` (до 150, латинские строчные буквы, цифры и одиночные дефисы между словами), `excerpt` (10–400), `content` (до 50000, не менее 30 символов видимого текста после очистки). Пробелы по краям текстовых полей удаляются, кроме `slug`.

Необязательные поля: `imageAlt` (до 250), `seoTitle` (150), `seoDescription` (300), `seoKeywords` (1000), `published` и `publishedAt`. По умолчанию SEO-поля пустые и `published=false`. Обложка загружается отдельным запросом. PATCH принимает непустой набор этих полей и отклоняет неизвестные поля; остальные значения сохраняются.

`content` принимает HTML с тегами `p, br, h2, h3, strong, em, u, s, a, blockquote, ol, ul, li`. Ссылки поддерживают HTTP, HTTPS и mailto; опасная разметка удаляется. Также принимается прежний текстовый формат: абзацы через пустую строку, заголовки `##`/`###`, списки `- ` и отдельные ссылки. Ответ содержит очищенный HTML, поэтому сверяйте результат сохранения.

- `{"published":true,"publishedAt":null}` публикует черновик сейчас.
- `{"published":true,"publishedAt":"2027-01-15T09:00:00+03:00"}` планирует будущую публикацию. До наступления даты ответ содержит `published=false` и заданное время.
- `{"published":false}` снимает с публикации и очищает расписание.
- Изменение текста без `published`/`publishedAt` сохраняет текущее состояние и расписание.
- В PATCH `publishedAt:null` отменяет расписание черновика; у опубликованной статьи прежняя дата сохраняется. Передавать дату нужно в ISO 8601 с часовым поясом.

Описание объекта — обычный текст до 30000 символов, без HTML-форматирования. PATCH принимает только `description`; пустая строка и DELETE очищают его. Оба запроса возвращают актуальный объект. Правка описания RF39 отмечается как ручная и сохраняется при последующей синхронизации.

JSON-запросы требуют `Content-Type: application/json` и `Content-Length`, максимальный размер — 256 КиБ в UTF-8. Для обложки принимаются JPEG, PNG и WebP до 10 МиБ, multipart-запрос целиком — до 12 МиБ; сервер сохраняет WebP. `curl` сам задаёт длину тела; при `-F` он также задаёт multipart Content-Type.

## Примеры для Bash

Задайте `API_TOKEN` в окружении через хранилище секретов агента:

```bash
BASE='https://example.com/api/agent/v1'

# Найти статью по точному slug перед созданием или повтором запроса.
curl --fail-with-body -sS "$BASE/articles?slug=kak-vybrat-kvartiru" \
  -H "Authorization: Bearer $API_TOKEN"

# Создать черновик; сохраните id из ответа.
curl --fail-with-body -sS "$BASE/articles" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"title":"Как выбрать квартиру","slug":"kak-vybrat-kvartiru","excerpt":"На что обратить внимание при выборе квартиры.","content":"<p>Сравните расположение, планировку и состояние дома перед покупкой квартиры.</p>"}'

ARTICLE_ID='id_из_ответа'
curl --fail-with-body -sS "$BASE/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $API_TOKEN"

# Изменить только анонс, сохранив текст и публикацию.
curl --fail-with-body -sS -X PATCH "$BASE/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"excerpt":"Практические советы для выбора подходящей квартиры."}'

# Загрузить локальную обложку.
curl --fail-with-body -sS "$BASE/articles/$ARTICLE_ID/image" \
  -H "Authorization: Bearer $API_TOKEN" -F 'file=@cover.jpg'

# Найти объект по адресу/названию и затем прочитать его.
curl --fail-with-body -sS -G "$BASE/properties" \
  -H "Authorization: Bearer $API_TOKEN" --data-urlencode 'q=Калининград'
PROPERTY_ID='id_объекта'
curl --fail-with-body -sS "$BASE/properties/$PROPERTY_ID" \
  -H "Authorization: Bearer $API_TOKEN"
curl --fail-with-body -sS -X PATCH "$BASE/properties/$PROPERTY_ID/description" \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"description":"Светлая квартира с удобной планировкой и отдельной кухней."}'

# Выполняйте удаление только когда оно входит в задачу агента.
curl --fail-with-body -sS -X DELETE "$BASE/properties/$PROPERTY_ID/description" \
  -H "Authorization: Bearer $API_TOKEN"
curl --fail-with-body -sS -X DELETE "$BASE/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $API_TOKEN"
```

## Ошибки и порядок работы агента

Успешные операции возвращают 200 и JSON. Ошибки: 400 — неверные поля/запрос, 401 — отсутствующий или неверный токен, 404 — запись не найдена, 409 — занятый slug или конфликт изменения статьи, 411 — нет Content-Length, 413 — превышен размер, 415 — неверный Content-Type, 503 — API не настроен. Читайте `statusCode`, `statusMessage` и, при наличии, `data` в JSON ошибки.

Сначала найдите и прочитайте запись, затем отправьте PATCH только нужных полей и проверьте ответ. После сетевого сбоя при POST не создавайте статью вслепую повторно: проверьте результат через поиск по уникальному slug. При 409 перечитайте запись и согласуйте изменения с её актуальным состоянием.

API не хранит историю правок и не требует версию записи от клиента: правка, подготовленная по старому чтению, может заменить более свежую. PATCH статьи обнаруживает изменение между внутренним чтением и записью запроса. Не запускайте нескольких редакторов над одной записью одновременно.
