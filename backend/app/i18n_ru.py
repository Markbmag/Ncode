"""Russian texts of the server messages (used by app/i18n.py).

Keys are the English messages exactly as written in the code, f-string placeholders included
("Unknown table {table!r}"); the Russian keeps the same placeholders. tests/test_i18n_ru.py scans
the backend and fails when a message has no entry here, or when the placeholders differ.
Wording follows the UI dictionaries (frontend/src/i18n/ru): question = вопрос, dashboard = дашборд,
collection = коллекция, connection/database = база данных, column = столбец, card = карточка,
export = выгрузка, subscription = подписка, alert = оповещение, row rules = ограничение строк.
"""

from __future__ import annotations

RU: dict[str, str] = {
    # ---------------------------------------------------------------- app/api.py
    "Not authenticated": "Вы не вошли в систему",
    "Unknown connection {key!r}": "Неизвестная база данных {key!r}",
    "Unknown or expired task": "Задача не найдена или устарела",
    "Authentication is disabled": "Вход по паролю отключён",
    "Too many failed attempts": "Слишком много неудачных попыток",
    "Invalid username or password": "Неверное имя пользователя или пароль",
    "Only an administrator can do this": "Это может сделать только администратор",
    "File not found on the server: {raw}": "Файл не найден на сервере: {raw}",
    "Ncode's own database cannot be connected": "Собственную базу данных Ncode подключить нельзя",
    "Cannot read the file: {exc.strerror or exc}": "Не удаётся прочитать файл: {exc.strerror or exc}",
    "This is not a SQLite file": "Это не файл SQLite",
    "Unknown database type: {payload.engine}": "Неизвестный тип базы данных: {payload.engine}",
    "Enter the server address (host)": "Укажите адрес сервера (host)",
    "The driver for {info.label} is not installed. Run on the server: pip install {info.pip} — then restart the backend.":
        "Драйвер для {info.label} не установлен. Выполните на сервере: pip install {info.pip} — и перезапустите backend.",
    "This connection is defined in the .env file — it can only be changed there":
        "Эта база данных описана в файле .env — изменить её можно только там",
    "When changing the server, port or user, enter the password again":
        "При смене сервера, порта или пользователя введите пароль ещё раз",
    "Could not read the database structure: {detail}": "Не удалось прочитать структуру базы данных: {detail}",
    "The query failed: {detail}": "Запрос не выполнен: {detail}",
    "Could not read the table: {detail}": "Не удалось прочитать таблицу: {detail}",
    "The export failed: {detail}": "Выгрузка не удалась: {detail}",
    "You already have {settings.max_concurrent_searches} searches running. Wait for one to finish or cancel it.":
        "У вас уже выполняется поисков: {settings.max_concurrent_searches}. Дождитесь окончания одного из них или отмените его.",
    # ---------------------------------------------------------------- app/errors.py
    "Something went wrong on the server (error id {error_id}). Try again; if it keeps happening, tell your administrator.":
        "На сервере что-то пошло не так (код ошибки {error_id}). Попробуйте ещё раз; если ошибка повторяется, "
        "сообщите администратору.",
    # ---------------------------------------------------------------- app/dberrors.py
    "The database driver is not installed. Run on the server: {pip} - then restart the backend.":
        "Драйвер базы данных не установлен. Выполните на сервере: {pip} — и перезапустите backend.",
    "The database has too many open connections right now. Try again in a minute; if it keeps happening, ask your administrator.":
        "У базы данных сейчас слишком много открытых подключений. Попробуйте через минуту; если ошибка повторяется, "
        "обратитесь к администратору.",
    "The user `{user}` may not open the database `{database}` - the name may be wrong, or access was not granted. Check the database name in the connection settings or ask your administrator.":
        "Пользователю `{user}` нельзя открыть базу данных `{database}` — возможно, имя указано неверно или доступ "
        "не выдан. Проверьте имя базы данных в настройках подключения или обратитесь к администратору.",
    "The database user `{user}` doesn't exist on the server - check the username in the connection settings.":
        "Пользователя базы данных `{user}` на сервере нет — проверьте имя пользователя в настройках подключения.",
    "Wrong username or password for the database user `{user}`. Check the login details in the connection settings.":
        "Неверное имя пользователя или пароль для пользователя базы данных `{user}`. Проверьте данные для входа "
        "в настройках подключения.",
    "Wrong username or password for the database. Check the login details in the connection settings.":
        "Неверное имя пользователя или пароль для базы данных. Проверьте данные для входа в настройках подключения.",
    "The database `{database}` doesn't exist on the server - check its name in the connection settings.":
        "Базы данных `{database}` на сервере нет — проверьте её имя в настройках подключения.",
    "The database file cannot be opened - check that the path is right and that the server may read the file.":
        "Не удаётся открыть файл базы данных — проверьте путь и есть ли у сервера право читать файл.",
    "The server name `{host}` cannot be found - check the host name, and whether the VPN is on.":
        "Сервер `{host}` не найден — проверьте имя сервера и включён ли VPN.",
    "The server name cannot be found - check the host name, and whether the VPN is on.":
        "Сервер не найден — проверьте имя сервера и включён ли VPN.",
    "The database server refused the connection - check the host and port, and whether the database service is running.":
        "Сервер базы данных отклонил подключение — проверьте адрес и порт, а также запущена ли служба базы данных.",
    "SQL Server did not accept the connection - check the database name, username and password in the connection settings.":
        "SQL Server не принял подключение — проверьте имя базы данных, имя пользователя и пароль в настройках подключения.",
    "The connection to the database was lost during the query. Run it again; if it keeps happening, ask your administrator.":
        "Соединение с базой данных прервалось во время запроса. Запустите его ещё раз; если ошибка повторяется, "
        "обратитесь к администратору.",
    "The query took too long and the database stopped it. Add filters or a shorter date range, or ask your administrator to raise the time limit.":
        "Запрос выполнялся слишком долго, и база данных его остановила. Добавьте фильтры или сократите период "
        "либо попросите администратора увеличить лимит времени.",
    "The query collided with another task working on the same data (a deadlock) and was stopped. Run it again.":
        "Запрос столкнулся с другой задачей, работающей с теми же данными (взаимная блокировка), и был остановлен. "
        "Запустите его ещё раз.",
    "The data is locked by another task right now, so the query waited too long. Try again in a moment.":
        "Данные сейчас заблокированы другой задачей, и запрос ждал слишком долго. Попробуйте ещё раз чуть позже.",
    "Cannot reach the database server - check the host and port, whether the VPN is on, and whether a firewall allows the connection.":
        "Не удаётся связаться с сервером базы данных — проверьте адрес и порт, включён ли VPN и разрешает ли "
        "подключение файрвол.",
    "The database user of this connection may not read `{object}`. Ask your administrator to grant access.":
        "Пользователю базы данных этого подключения нельзя читать `{object}`. Попросите администратора выдать доступ.",
    "The database refused this because the connection's user lacks a permission. Ask your administrator to grant access.":
        "База данных отказала: у пользователя подключения нет нужного права. Попросите администратора выдать доступ.",
    "The column name `{column}` is used by more than one table - put the table name in front of it, like `table.{column}`.":
        "Столбец `{column}` есть в нескольких таблицах — укажите перед ним имя таблицы, например `таблица.{column}`.",
    "The column `{column}` must be in the GROUP BY list or inside a summary such as SUM() or MAX().":
        "Столбец `{column}` должен быть в списке GROUP BY или внутри агрегатной функции, например SUM() или MAX().",
    "Every column must be in the GROUP BY list or inside a summary such as SUM() or MAX().":
        "Каждый столбец должен быть в списке GROUP BY или внутри агрегатной функции, например SUM() или MAX().",
    "The column `{column}` doesn't exist in `{table}` - it may have been renamed or removed. Open the question and pick another column, or fix the name in the SQL.":
        "Столбца `{column}` нет в `{table}` — возможно, его переименовали или удалили. Откройте вопрос и выберите "
        "другой столбец или исправьте имя в SQL.",
    "The column `{column}` doesn't exist - it may have been renamed or removed. Open the question and pick another column, or fix the name in the SQL.":
        "Столбца `{column}` нет — возможно, его переименовали или удалили. Откройте вопрос и выберите другой "
        "столбец или исправьте имя в SQL.",
    "The table `{table}` doesn't exist - it may have been renamed or removed, or this connection's user can't see it. Pick another table, or fix the name in the SQL.":
        "Таблицы `{table}` нет — возможно, её переименовали или удалили, или пользователь подключения её не видит. "
        "Выберите другую таблицу или исправьте имя в SQL.",
    "The database doesn't know the function `{function}`, or not for these kinds of values - check its spelling and its arguments; every database type has its own function names.":
        "База данных не знает функцию `{function}` или не принимает её с такими значениями — проверьте написание "
        "и аргументы; у каждого типа баз данных свои имена функций.",
    "The query divides by zero. Wrap the divisor in NULLIF(..., 0) so that rows where it is 0 give an empty value instead.":
        "В запросе деление на ноль. Оберните делитель в NULLIF(..., 0) — тогда строки с нулевым делителем дадут "
        "пустое значение.",
    "A number got too big for its data type. Convert it to a larger type (BIGINT or DECIMAL) with CAST.":
        "Число слишком велико для своего типа данных. Преобразуйте его в больший тип (BIGINT или DECIMAL) с помощью CAST.",
    "The value `{value}` can't be read as {type}. Check the filter value, or convert the column with CAST.":
        "Значение `{value}` нельзя прочитать как {type}. Проверьте значение фильтра или преобразуйте столбец с помощью CAST.",
    "A value can't be converted to the type it is used as. Check the filter value, or convert the column with CAST.":
        "Значение нельзя преобразовать в нужный тип. Проверьте значение фильтра или преобразуйте столбец с помощью CAST.",
    "Values of different types are compared or combined here ({types}). Compare like with like, or convert one side with CAST.":
        "Здесь сравниваются или объединяются значения разных типов ({types}). Сравнивайте однотипные значения или "
        "преобразуйте одну из сторон с помощью CAST.",
    "Values of different types are compared or combined here. Compare like with like, or convert one side with CAST.":
        "Здесь сравниваются или объединяются значения разных типов. Сравнивайте однотипные значения или "
        "преобразуйте одну из сторон с помощью CAST.",
    "The SQL ends too early - something is missing at the end (for example a condition after WHERE, or a closing bracket).":
        "SQL обрывается — в конце чего-то не хватает (например, условия после WHERE или закрывающей скобки).",
    "The SQL has a syntax error near `{near}` (line {line}). Check for a missing comma, bracket, quote or keyword.":
        "Синтаксическая ошибка в SQL рядом с `{near}` (строка {line}). Проверьте, не пропущены ли запятая, скобка, "
        "кавычка или ключевое слово.",
    "The SQL has a syntax error near `{near}`. Check for a missing comma, bracket, quote or keyword.":
        "Синтаксическая ошибка в SQL рядом с `{near}`. Проверьте, не пропущены ли запятая, скобка, кавычка или "
        "ключевое слово.",
    "The SQL has a syntax error. Check for a missing comma, bracket, quote or keyword.":
        "Синтаксическая ошибка в SQL. Проверьте, не пропущены ли запятая, скобка, кавычка или ключевое слово.",
    # ---------------------------------------------------------------- app/admin_routes.py
    "give at least one value": "укажите хотя бы одно значение",
    "Unknown group {n!r}": "Неизвестная группа {n!r}",
    "No such user": "Такого пользователя нет",
    "This is the last active admin: make someone else admin first":
        "Это последний активный администратор: сначала назначьте администратором кого-то другого",
    "You cannot delete yourself": "Нельзя удалить самого себя",
    "This is the last active admin": "Это последний активный администратор",
    "Unknown user {n!r}": "Неизвестный пользователь {n!r}",
    "No such group": "Такой группы нет",
    "Unknown connection {body.connection!r}": "Неизвестная база данных {body.connection!r}",
    "Unknown table {body.table!r}": "Неизвестная таблица {body.table!r}",
    "{table} has no column {body.column!r}": "В {table} нет столбца {body.column!r}",
    "No such rule": "Такого правила нет",
    "Sign-in is turned off": "Вход отключён",
    "The current password is wrong": "Текущий пароль неверен",
    "the password needs at least {MIN_PASSWORD_LENGTH} characters":
        "пароль слишком короткий: нужно не меньше символов: {MIN_PASSWORD_LENGTH}",
    "{value!r} is not an email address": "{value!r} — не адрес электронной почты",
    "3-64 characters: letters, digits, dot, dash, underscore":
        "3–64 символа: буквы, цифры, точка, дефис, подчёркивание",
    # ---------------------------------------------------------------- app/analysis/routes.py
    "The table has no columns to profile": "В таблице нет столбцов для профиля данных",
    "X-ray works on tables and questions built without SQL": "X-ray работает с таблицами и вопросами без SQL",
    "Unknown or expired query": "Запрос не найден или устарел",
    "The query has no finished result to profile": "У запроса нет готового результата для профиля данных",
    "give connection and table, or question_id": "укажите connection и table или question_id",
    "Profiles and X-rays need the duckdb package: pip install -r requirements.txt":
        "Для профилей данных и X-ray нужен пакет duckdb: pip install -r requirements.txt",
    "Unknown table {table!r}": "Неизвестная таблица {table!r}",
    # ---------------------------------------------------------------- app/appdb.py
    "User {username!r} already exists": "Пользователь {username!r} уже существует",
    "A group named {name!r} already exists": "Группа с именем {name!r} уже существует",
    "No encryption key configured": "Ключ шифрования не настроен",
    "Connection {cfg.key!r} already exists": "База данных {cfg.key!r} уже существует",
    # ---------------------------------------------------------------- app/automation
    "{what} could not be reached: {str(reason)[:200]}": "Не удалось связаться с {what}: {str(reason)[:200]}",
    "The email server refused the user name or password": "Почтовый сервер не принял имя пользователя или пароль",
    "Cannot reach the email server {cfg.host}:{cfg.port}: {_reason(exc)}":
        "Не удаётся связаться с почтовым сервером {cfg.host}:{cfg.port}: {_reason(exc)}",
    "Email is not set up yet: Admin → Delivery → Email server":
        "Почта ещё не настроена: Администрирование → Доставка → Почтовый сервер",
    "The dashboard is gone or not shared with the subscription's owner any more":
        "Дашборд удалён или больше не доступен владельцу подписки",
    "This question is not shared with the subscription's owner": "Этот вопрос не доступен владельцу подписки",
    "The question is gone or not shared with the subscription's owner any more":
        "Вопрос удалён или больше не доступен владельцу подписки",
    "No such {body.target_type}, or it is not shared with you": "{body.target_type} не найден или не доступен вам",
    "Add at least one recipient": "Добавьте хотя бы одного получателя",
    "Unknown user {name!r}": "Неизвестный пользователь {name!r}",
    "{e} is outside the allowed domains ({', '.join(domains)}). An admin can send there.":
        "{e} — вне разрешённых доменов ({', '.join(domains)}). Отправить туда может администратор.",
    "A chosen destination does not exist any more": "Выбранного канала доставки больше нет",
    "A subscription stays on its dashboard or question": "Подписка остаётся привязанной к своему дашборду или вопросу",
    "It is being sent right now": "Отправка уже идёт",
    "It was sent less than {MANUAL_COOLDOWN_SEC} seconds ago":
        "С последней отправки прошло меньше {MANUAL_COOLDOWN_SEC} с",
    "You are not a recipient of this subscription": "Вы не получатель этой подписки",
    "{email!r} is not an email address": "{email!r} — не адрес электронной почты",
    "Sign-in is turned off: there is no account to keep an address for":
        "Вход отключён: нет учётной записи, для которой можно сохранить адрес",
    "Not an email address": "Это не адрес электронной почты",
    "Its address cannot be read (was the secret key changed?)":
        "Не удаётся прочитать его адрес (не был ли изменён секретный ключ?)",
    "days are 0 (Monday) to 6 (Sunday)": "дни — от 0 (понедельник) до 6 (воскресенье)",
    "unknown time zone {value!r}": "неизвестный часовой пояс {value!r}",
    "choose at least one day": "выберите хотя бы один день",
    "monthday is 1-28, or -1 for the last day of the month": "день месяца — от 1 до 28 или -1 для последнего дня месяца",
    "A Telegram bot token looks like 123456789:AA… (from @BotFather)":
        "Токен бота Telegram выглядит так: 123456789:AA… (его выдаёт @BotFather)",
    "Paste the webhook address (https://…)": "Вставьте адрес вебхука (https://…)",
    "Secrets cannot be stored: the server has no encryption key":
        "Секреты нельзя сохранить: у сервера нет ключа шифрования",
    "No such destination": "Такого канала доставки нет",
    "Paste the webhook address or bot token": "Вставьте адрес вебхука или токен бота",
    "A Telegram chat id is a number (groups start with -100…) or @channelname":
        "Идентификатор чата Telegram — это число (у групп начинается с -100…) или @имяканала",
    "Another kind of destination needs its own address or token":
        "Для канала доставки другого вида нужен свой адрес или токен",
    "{d!r} is not a domain": "{d!r} — не домен",
    "the site address starts with http:// or https://": "адрес сайта начинается с http:// или https://",
    "alerts watch a question, not a dashboard": "оповещения следят за вопросом, а не за дашбордом",
    "No such subscription": "Такой подписки нет",
    "{e!r} is not an email address": "{e!r} — не адрес электронной почты",
    "give the value to compare with": "укажите значение для сравнения",
    # ---------------------------------------------------------------- app/backup.py, app/ops_routes.py, app/crypto.py
    "No such backup": "Такой резервной копии нет",
    "{zip_path} does not exist": "{zip_path} не существует",
    "This is not an Ncode backup (ncode.sqlite / manifest.json missing)":
        "Это не резервная копия Ncode (нет ncode.sqlite / manifest.json)",
    "Unsafe path in the backup: {n}": "Небезопасный путь в резервной копии: {n}",
    "The database in the backup is damaged: {ok}": "База данных в резервной копии повреждена: {ok}",
    "The backup failed: {exc}": "Резервное копирование не удалось: {exc}",
    "Admins only, or the metrics token": "Только для администраторов или с токеном метрик",
    "Cannot decrypt the saved password - was the secret key changed or lost?":
        "Не удаётся расшифровать сохранённый пароль — не был ли секретный ключ изменён или утерян?",
    # ---------------------------------------------------------------- app/content
    "Invalid dashboard: base_updated_at must be a number": "Неверный дашборд: base_updated_at должно быть числом",
    "No such question card on this dashboard": "На этом дашборде нет такой карточки вопроса",
    "The question on this card was deleted": "Вопрос этой карточки удалён",
    "This question is not shared with you": "Этот вопрос вам не доступен",
    "refresh is one of 0, 30, 60, 300, 900 seconds": "обновление — одно из значений 0, 30, 60, 300, 900 секунд",
    "unknown settings: {', '.join(sorted(unknown))}": "неизвестные настройки: {', '.join(sorted(unknown))}",
    "{what} ids must be unique": "{what}: идентификаторы должны быть уникальными",
    "card {c.key} is on an unknown tab": "карточка {c.key} находится на неизвестной вкладке",
    "card {c.key} names a tab, but the dashboard has none": "у карточки {c.key} указана вкладка, но у дашборда вкладок нет",
    "card {c.key} maps unknown filter {fid!r}": "карточка {c.key} связана с неизвестным фильтром {fid!r}",
    "Filter {label!r} needs a date like 2026-01-31": "Для фильтра {label!r} нужна дата вида 2026-01-31",
    "Filter {label!r} is not a real date: {value!r}": "В фильтре {label!r} несуществующая дата: {value!r}",
    "Give a value for the filter {f.label!r}": "Укажите значение фильтра {f.label!r}",
    "Filter {f.label!r} needs two dates (from, to)": "Для фильтра {f.label!r} нужны две даты (с, по)",
    "Filter {f.label!r} needs a number": "Для фильтра {f.label!r} нужно число",
    "Filter {f.label!r} needs a number, not {value!r}": "Для фильтра {f.label!r} нужно число, а не {value!r}",
    "Filter {f.label!r} has {len(value)} values, but {{{param}}} takes {'two' if shape == 'pair' else 'one'}":
        "У фильтра {f.label!r} значений: {len(value)}, а {{{param}}} принимает {'two' if shape == 'pair' else 'one'}",
    "Filter {f.label!r} has one value, but parameter {param!r} needs two (between)":
        "У фильтра {f.label!r} одно значение, а параметру {param!r} нужно два (между)",
    "Only questions built without SQL can be filtered by a column; map the filter to a parameter":
        "По столбцу можно фильтровать только вопросы без SQL; свяжите фильтр с параметром",
    "Dashboard not found": "Дашборд не найден",
    "Question {c.question_id} does not exist or is not shared with you":
        "Вопрос {c.question_id} не существует или вам не доступен",
    "Card {c.key} has no question: choose one or remove the card":
        "У карточки {c.key} нет вопроса: выберите вопрос или удалите карточку",
    "Archive the dashboard first; only archived dashboards can be deleted":
        "Сначала отправьте дашборд в архив; удалять можно только архивные дашборды",
    "a mapping names either a param or a field": "в связи указывается либо параметр, либо поле",
    "only question cards have a question and filter mappings": "вопрос и связи фильтров бывают только у карточек вопросов",
    "card {self.key} is wider than the grid": "карточка {self.key} шире сетки",
    "Parameter {name!r} needs two values (from, to) for 'between'":
        "Параметру {name!r} нужны два значения (с, по) для «между»",
    "Parameter {name!r} takes one value here": "Параметр {name!r} здесь принимает одно значение",
    "Filter parameter {name!r} is not declared": "Параметр фильтра {name!r} не объявлен",
    "The '{op}' filter cannot take its value from a parameter": "Фильтр '{op}' не может брать значение из параметра",
    "Parameter {d.name!r} takes one value in SQL": "Параметр {d.name!r} в SQL принимает одно значение",
    "Parameter {defn.name!r}: a single value was expected": "Параметр {defn.name!r}: ожидалось одно значение",
    "Parameter {defn.name!r} must be a number": "Параметр {defn.name!r} должен быть числом",
    "Parameter {defn.name!r} must be a number, not {raw!r}": "Параметр {defn.name!r} должен быть числом, а не {raw!r}",
    "Parameter {defn.name!r} must be a date like 2026-01-31, not {raw!r}":
        "Параметр {defn.name!r} должен быть датой вида 2026-01-31, а не {raw!r}",
    "Parameter {defn.name!r} is not a real date: {raw!r}": "В параметре {defn.name!r} несуществующая дата: {raw!r}",
    "Parameter {defn.name!r} is limited to 500 characters": "Параметр {defn.name!r} ограничен 500 символами",
    "Parameter {defn.name!r} takes at most {MAX_LIST} values":
        "Параметр {defn.name!r} принимает не больше значений, чем {MAX_LIST}",
    "Give a value for {d.label or d.name}": "Укажите значение для {d.label or d.name}",
    "Invalid question: {exc.errors()[0]['msg']}": "Неверный вопрос: {exc.errors()[0]['msg']}",
    "The question's spec belongs to another connection": "Описание вопроса относится к другой базе данных",
    "Invalid SQL question: {exc.errors()[0]['msg']}": "Неверный SQL-вопрос: {exc.errors()[0]['msg']}",
    "A SQL question needs a connection": "Для SQL-вопроса нужна база данных",
    "The chart settings are too large": "Настройки диаграммы слишком большие",
    "The saved question is not valid any more: {exc.errors()[0]['msg']}":
        "Сохранённый вопрос больше не корректен: {exc.errors()[0]['msg']}",
    "Unknown question kind {q.kind!r}": "Неизвестный вид вопроса {q.kind!r}",
    "Collection not found": "Коллекция не найдена",
    "Question not found": "Вопрос не найден",
    "{what} not found": "Не найдено: {what}",
    "Someone else{who} saved this {what} after you opened it. Reload to see their version, or save again without the check to overwrite it.":
        "Пока вы редактировали ({what}), кто-то другой{who} сохранил свою версию. Обновите страницу, чтобы увидеть её, "
        "или сохраните ещё раз без проверки, чтобы перезаписать.",
    "A name is required": "Нужно название",
    "Names are limited to {limit} characters": "Название — не больше символов: {limit}",
    "You can only view this collection": "Эту коллекцию вы можете только просматривать",
    "The collection {snap.get(cid).name!r} is archived. Restore it first (Library → Archive), or choose another collection":
        "Коллекция {snap.get(cid).name!r} в архиве. Сначала восстановите её (Библиотека → Архив) или выберите другую коллекцию",
    "Only the owner of this collection (or an admin) can do that":
        "Это может сделать только владелец коллекции (или администратор)",
    "Collections can be nested at most {MAX_DEPTH} levels deep":
        "Коллекции можно вкладывать не глубже, чем на уровней: {MAX_DEPTH}",
    "A personal collection cannot be renamed": "Личную коллекцию нельзя переименовать",
    "A personal collection cannot be moved": "Личную коллекцию нельзя переместить",
    "A collection cannot be moved into itself": "Коллекцию нельзя переместить в саму себя",
    "A personal collection cannot be archived": "Личную коллекцию нельзя отправить в архив",
    "Archive the collection first; only archived collections can be deleted":
        "Сначала отправьте коллекцию в архив; удалять можно только архивные коллекции",
    "Personal collections cannot be shared; move the questions to a shared collection":
        "Личными коллекциями нельзя поделиться; перенесите вопросы в общую коллекцию",
    "level must be 'view' or 'edit'": "уровень должен быть 'view' или 'edit'",
    "each grant names one user, group or role": "каждое разрешение указывает одного пользователя, группу или роль",
    "Unknown user {g['user']!r}": "Неизвестный пользователь {g['user']!r}",
    "Unknown group {g['group']!r}": "Неизвестная группа {g['group']!r}",
    "role must be one of {', '.join(ROLES)}": "роль должна быть одной из: {', '.join(ROLES)}",
    "Archive the question first; only archived questions can be deleted":
        "Сначала отправьте вопрос в архив; удалять можно только архивные вопросы",
    # ---------------------------------------------------------------- app/federation
    "Joining {join.source!r}: the key columns cannot be compared as they are ({str(exc).splitlines()[0]}). Compare them as text or as numbers instead.":
        "Соединение с {join.source!r}: ключевые столбцы нельзя сравнить как есть ({str(exc).splitlines()[0]}). "
        "Сравнивайте их как текст или как числа.",
    "Unknown source {alias!r} in {ref!r}": "Неизвестный источник {alias!r} в {ref!r}",
    "{alias!r} has no column {column!r}": "В {alias!r} нет столбца {column!r}",
    "The file has more than {max_rows:,} rows (the limit for uploads)":
        "В файле больше {max_rows:,} строк (это предел для загрузок)",
    "The file has no data rows": "В файле нет строк с данными",
    "Could not open the workbook: {str(exc).splitlines()[0] if str(exc) else type(exc).__name__}":
        "Не удалось открыть книгу: {str(exc).splitlines()[0] if str(exc) else type(exc).__name__}",
    "The workbook has no sheet {options.sheet!r} (sheets: {', '.join(wb.sheetnames)})":
        "В книге нет листа {options.sheet!r} (листы: {', '.join(wb.sheetnames)})",
    "The sheet has more than {max_rows:,} rows (the limit for uploads)":
        "На листе больше {max_rows:,} строк (это предел для загрузок)",
    "The sheet is empty": "Лист пуст",
    "The dataset's file name is not valid": "Недопустимое имя файла",
    "Dataset not found": "Файл не найден",
    "Archive the dataset first; only archived datasets can be deleted":
        "Сначала отправьте файл в архив; удалять можно только архивные файлы",
    "Old .xls workbooks cannot be read: save the file as .xlsx or .csv":
        "Старые книги .xls не читаются: сохраните файл как .xlsx или .csv",
    "Upload a .csv, .tsv, .xlsx or .parquet file": "Загрузите файл .csv, .tsv, .xlsx или .parquet",
    "Unknown delimiter {options.delimiter!r}": "Неизвестный разделитель {options.delimiter!r}",
    "Unknown encoding {options.encoding!r}": "Неизвестная кодировка {options.encoding!r}",
    "Unknown number format {options.number_format!r}": "Неизвестный формат чисел {options.number_format!r}",
    "A comma cannot be both the separator and the decimal mark: choose another separator":
        "Запятая не может быть одновременно разделителем и десятичным знаком: выберите другой разделитель",
    "Unknown table {table!r}: the SQL can only use the sources ({', '.join(aliases)})":
        "Неизвестная таблица {table!r}: в SQL можно использовать только источники ({', '.join(aliases)})",
    "Multi-source questions and uploads need the duckdb package: pip install -r requirements.txt":
        "Для вопросов из нескольких источников и загрузок нужен пакет duckdb: pip install -r requirements.txt",
    "the uploaded file is archived": "загруженный файл в архиве",
    "a multi-source question cannot be a source of another one":
        "вопрос из нескольких источников не может быть источником для другого",
    "Give a value for {', '.join(missing)}": "Укажите значение для {', '.join(missing)}",
    "Uploads are turned off on this server": "Загрузка файлов на этом сервере отключена",
    "The file is larger than {settings.dataset_max_mb} MB": "Файл больше {settings.dataset_max_mb} МБ",
    "The file is empty": "Файл пуст",
    "source names must be unique": "имена источников должны быть уникальными",
    "write the SQL that combines the sources": "напишите SQL, объединяющий источники",
    "the join refers to an unknown source {j.source!r}": "соединение ссылается на неизвестный источник {j.source!r}",
    "{j.source!r} is joined twice (or is the first source)":
        "{j.source!r} соединяется дважды (или это первый источник)",
    "joining {j.source!r}: each key pairs a column of {j.source!r} with one of {', '.join(sorted(joined))}":
        "соединение с {j.source!r}: каждый ключ связывает столбец {j.source!r} со столбцом одного из: {', '.join(sorted(joined))}",
    "join {', '.join((repr(a) for a in loose))} to the other sources, or remove it":
        "соедините {', '.join((repr(a) for a in loose))} с другими источниками или удалите",
    "{ref!r} should look like source.column": "{ref!r} должно иметь вид источник.столбец",
    "a {self.type} source needs {need}": "источнику {self.type} нужно: {need}",
    "a sql source needs a connection": "SQL-источнику нужна база данных",
    "{self.alias!r} cannot be used as a source name": "{self.alias!r} нельзя использовать как имя источника",
    # ---------------------------------------------------------------- app/models.py
    "phrase must not be empty": "фраза не должна быть пустой",
    "must not be empty": "не должно быть пустым",
    # ---------------------------------------------------------------- app/query
    "Unknown table {name!r}": "Неизвестная таблица {name!r}",
    "The table {alias!r} is already in the question; give the join an alias":
        "Таблица {alias!r} уже есть в вопросе; задайте соединению псевдоним",
    "{ref!r} exists in several tables; write it as table.column":
        "{ref!r} есть в нескольких таблицах; укажите его как таблица.столбец",
    "Unknown column {ref!r}": "Неизвестный столбец {ref!r}",
    "The expression is nested too deeply": "Выражение вложено слишком глубоко",
    "'{e.op}' works on numbers, not on {side.type}": "'{e.op}' работает с числами, а не с {side.type}",
    "nullif() needs exactly 2 args": "nullif() нужны ровно 2 аргумента",
    "Unknown function {fn!r}": "Неизвестная функция {fn!r}",
    "The filter is nested too deeply": "Фильтр вложен слишком глубоко",
    "'{op}' needs {what}; {label} is {kind}": "'{op}' нужно {what}; {label} — {kind}",
    "'{op}' does not work on {kind} columns": "'{op}' не работает со столбцами типа {kind}",
    "'{op}' needs between 1 and {MAX_IN_VALUES} values": "'{op}' нужно от 1 до {MAX_IN_VALUES} значений",
    "'between' needs two values: [from, to]": "'between' нужны два значения: [с, по]",
    "A value is required for {label}": "Нужно значение для {label}",
    "Expected a single value for {label}": "Для {label} ожидалось одно значение",
    "{value!r} is not a valid {kind} for {label}": "{value!r} — недопустимое значение ({kind}) для {label}",
    "Filter values are limited to 500 characters": "Значения фильтра ограничены 500 символами",
    "'{op}' needs a value like {\"amount\": 30, \"unit\": \"day\"}":
        "'{op}' нужно значение вида {\"amount\": 30, \"unit\": \"day\"}",
    "Duplicate custom column {custom.name!r}": "Вычисляемый столбец {custom.name!r} повторяется",
    "Sort a summarised question by one of its columns: {', '.join(names)}":
        "Сортируйте сгруппированный вопрос по одному из его столбцов: {', '.join(names)}",
    "FULL JOIN is not supported by MySQL / MariaDB; use a left join":
        "MySQL / MariaDB не поддерживают FULL JOIN; используйте левое соединение",
    "Unknown join column in {pair.left} = {pair.right}": "Неизвестный столбец соединения в {pair.left} = {pair.right}",
    "{real_target!r} is already in the question; to join it again give an alias and the join condition":
        "{real_target!r} уже есть в вопросе; чтобы соединить её ещё раз, задайте псевдоним и условие соединения",
    "No relationship (foreign key) connects {real_target!r} to the tables in this question; give the join condition yourself":
        "Ни одна связь (внешний ключ) не соединяет {real_target!r} с таблицами этого вопроса; задайте условие "
        "соединения сами",
    "Grouping by {b.bucket} needs a date column; {b.ref} is {typed.type}":
        "Для группировки по {b.bucket} нужен столбец с датой; {b.ref} — {typed.type}",
    "Binning needs a number column; {b.ref} is {typed.type}":
        "Для разбиения на интервалы нужен числовой столбец; {b.ref} — {typed.type}",
    "Cannot group by a {typed.type} column ({b.ref})": "Нельзя группировать по столбцу типа {typed.type} ({b.ref})",
    "Metric {a.metric} is not available": "Метрика {a.metric} недоступна",
    "{a.fn} needs a number column; {a.ref or 'the expression'} is {typed.type}":
        "Для {a.fn} нужен числовой столбец; {a.ref or 'the expression'} — {typed.type}",
    "{a.fn} does not work on {typed.type} columns": "{a.fn} не работает со столбцами типа {typed.type}",
    "Grouping by {unit} is not supported on {dialect}": "Группировка по {unit} не поддерживается в {dialect}",
    "Reading dates from text is not supported on {dialect}": "Чтение дат из текста не поддерживается в {dialect}",
    "You already have {settings.max_concurrent_queries} queries running. Wait for one to finish or cancel it.":
        "У вас уже выполняется запросов: {settings.max_concurrent_queries}. Дождитесь окончания одного из них или отмените его.",
    "Give a value for {', '.join(('{{' + m + '}}' for m in missing))}":
        "Укажите значение для {', '.join(('{{' + m + '}}' for m in missing))}",
    "The query has no finished result to export": "У запроса нет готового результата для выгрузки",
    "The query took longer than {self.timeout_sec} seconds and was stopped":
        "Запрос выполнялся дольше {self.timeout_sec} с и был остановлен",
    "The statement returned no rows": "Запрос не вернул строк",
    "a condition needs either ref or expr": "условию нужен либо ref, либо expr",
    "a field needs either ref or expr": "полю нужен либо ref, либо expr",
    "a metric aggregation names only the metric": "в агрегации-метрике указывается только метрика",
    "metric goes with fn 'metric'": "metric указывается вместе с fn 'metric'",
    "an aggregation takes ref or expr, not both": "агрегация принимает ref или expr, но не оба сразу",
    "{self.fn} needs a column (ref) or an expression": "{self.fn} нужен столбец (ref) или выражение",
    "a breakout needs either ref or expr": "группировке нужен либо ref, либо expr",
    "use bucket (dates) or bin_width (numbers), not both":
        "используйте bucket (даты) или bin_width (числа), но не оба сразу",
    "fields cannot be combined with aggregations/breakouts (group by the breakouts instead)":
        "поля нельзя сочетать с агрегациями и группировками (группируйте по группировкам)",
    "having needs aggregations or breakouts": "для having нужны агрегации или группировки",
    "custom expression names must be unique": "имена вычисляемых выражений должны быть уникальными",
    "an expression needs exactly one of: ref, value, op, fn, case": "выражению нужно ровно одно из: ref, value, op, fn, case",
    "text values are limited to 500 characters": "текстовые значения ограничены 500 символами",
    "'{self.op}' needs exactly 2 args": "'{self.op}' нужны ровно 2 аргумента",
    "{self.fn}() needs at least one arg": "{self.fn}() нужен хотя бы один аргумент",
    "Write a SELECT query": "Напишите запрос SELECT",
    "The query is longer than {MAX_SQL_CHARS:,} characters": "Запрос длиннее {MAX_SQL_CHARS:,} символов",
    "The query contains a NUL character": "В запросе есть символ NUL",
    "SQL mode is not available for {dialect}": "Режим SQL недоступен для {dialect}",
    "Could not read this SQL: {_first_line(exc)}": "Не удалось разобрать этот SQL: {_first_line(exc)}",
    "Run one statement at a time (remove the extra ';' statements)":
        "Запускайте по одной инструкции (уберите лишние инструкции через ';')",
    "Only SELECT queries are allowed (WITH ... SELECT and UNION too)":
        "Разрешены только запросы SELECT (а также WITH ... SELECT и UNION)",
    "Not allowed in a read-only query: {_describe(node)}": "Недопустимо в запросе только для чтения: {_describe(node)}",
    "The function {name.upper()}() is not allowed": "Функция {name.upper()}() запрещена",
    "The table hint {hint.name.upper()} is not allowed": "Табличная подсказка {hint.name.upper()} запрещена",
    "System tables ({_table_label(node)}) are only available to administrators":
        "Системные таблицы ({_table_label(node)}) доступны только администраторам",
    "MySQL executable comments (/*! ... */) are not allowed": "Исполняемые комментарии MySQL (/*! ... */) запрещены",
    "A /* comment is not closed": "Комментарий /* не закрыт",
    "In MySQL '--' needs a space after it to start a comment; write '-- ' or use '#'":
        "В MySQL после '--' нужен пробел, чтобы начать комментарий; напишите '-- ' или используйте '#'",
    "A quoted string or name is not closed": "Строка или имя в кавычках не закрыты",
    "{{{name}}} must be text, a number, a date, true/false or null":
        "{{{name}}} должен быть текстом, числом, датой, true/false или null",
    "{{{name}}} must be a finite number": "{{{name}}} должен быть конечным числом",
    "{{{name}}} is too large: whole numbers must be between {MIN_INT_PARAM:,} and {MAX_INT_PARAM:,}":
        "{{{name}}} слишком велик: целые числа должны быть от {MIN_INT_PARAM:,} до {MAX_INT_PARAM:,}",
    "Comparing with the previous period needs a date column (e.g. grouped by month)":
        "Для сравнения с предыдущим периодом нужен столбец с датой (например, с группировкой по месяцам)",
    "{what}: the result has no column {name!r} (columns: {', '.join(names)})":
        "{what}: в результате нет столбца {name!r} (столбцы: {', '.join(names)})",
    # ---------------------------------------------------------------- app/rowsec.py
    "Row-level rules apply to you on this database, so SQL is not available there. Use a question built without SQL.":
        "Для вас в этой базе данных действует ограничение строк, поэтому SQL там недоступен. Используйте вопрос без SQL.",
    "A row-level rule on {table} names a column that does not exist any more. Ask an admin.":
        "Правило ограничения строк для {table} ссылается на столбец, которого больше нет. Обратитесь к администратору.",
    # ---------------------------------------------------------------- app/semantic
    "{table!r} has no column {column!r}": "В {table!r} нет столбца {column!r}",
    "Relationship not found": "Связь не найдена",
    "Metric not found": "Метрика не найдена",
    "Metric {a.get('metric')} does not exist (any more) for this database":
        "Метрики {a.get('metric')} для этой базы данных нет (больше нет)",
    "the format is too large": "формат слишком большой",
    "give as many columns on each side": "укажите одинаковое число столбцов с каждой стороны",
    "a metric cannot be built from another metric": "метрику нельзя построить из другой метрики",
    "a metric takes ref or expr, not both": "метрика принимает ref или expr, но не оба сразу",
    "{self.fn} needs a column": "{self.fn} нужен столбец",
    # ---------------------------------------------------------------- app/sharing
    "No such {target_type}": "{target_type} не найден",
    "Public links are switched off: Admin → Sharing": "Публичные ссылки отключены: Администрирование → Общий доступ",
    "Embedding is switched off: Admin → Sharing": "Встраивание отключено: Администрирование → Общий доступ",
    "Create the embedding key first: Admin → Sharing":
        "Сначала создайте ключ встраивания: Администрирование → Общий доступ",
    "Too many requests, wait a minute": "Слишком много запросов, подождите минуту",
    "This link needs a password": "Для этой ссылки нужен пароль",
    "Embedding is switched off": "Встраивание отключено",
    "The token's \"resource\" names one dashboard or question": "Поле \"resource\" токена указывает один дашборд или вопрос",
    "This {target_type} may not be embedded": "{target_type}: встраивание запрещено",
    "The token's \"params\" is an object": "Поле \"params\" токена должно быть объектом",
    "The token must set {', '.join(missing)}": "В токене нужно задать: {', '.join(missing)}",
    "Too many requests, wait a moment": "Слишком много запросов, подождите немного",
    "This card cannot be shown with these filter values": "Эту карточку нельзя показать с такими значениями фильтров",
    "This card is not available": "Эта карточка недоступна",
    "Not a question": "Это не вопрос",
    "Not a dashboard": "Это не дашборд",
    "Downloads are not allowed on this link": "По этой ссылке скачивание запрещено",
    "Too many wrong passwords": "Слишком много неверных паролей",
    "Wrong password": "Неверный пароль",
    "Not found": "Не найдено",
    "No such link": "Такой ссылки нет",
    "Public links need the server's encryption key": "Для публичных ссылок нужен ключ шифрования сервера",
    "The expiry date is in the past": "Срок действия уже прошёл",
    "The embedding token is not valid": "Токен встраивания недействителен",
    "The embedding token must be signed with HS256": "Токен встраивания должен быть подписан HS256",
    "The embedding token's signature is wrong": "Подпись токена встраивания неверна",
    "The embedding token needs an expiry (\"exp\")": "Токену встраивания нужен срок действия (\"exp\")",
    "The embedding token has expired": "Срок действия токена встраивания истёк",
    "The embedding token may live at most 30 days": "Токен встраивания может действовать не больше 30 дней",
}

# Single words that fill a {placeholder} of another message ("Someone else saved this {what} ...").
WORDS: dict[str, str] = {
    "question": "вопрос",
    "dashboard": "дашборд",
    "collection": "коллекция",
    "dataset": "файл",
    "subscription": "подписка",
    "Question": "Вопрос",
    "Dashboard": "Дашборд",
    "Collection": "Коллекция",
    "Dataset": "Файл",
    "Metric": "Метрика",
    "Relationship": "Связь",
}

# Pydantic's own validation messages ("msg" of a 422 answer). The {placeholders} are filled by
# pydantic, so the names need not match the code; the Russian avoids number agreement.
PYDANTIC: dict[str, str] = {
    "Field required": "Обязательное поле",
    "Extra inputs are not permitted": "Лишнее поле не допускается",
    "Input should be a valid string": "Нужна строка",
    "Input should be a valid integer": "Нужно целое число",
    "Input should be a valid integer, unable to parse string as an integer": "Нужно целое число",
    "Input should be a valid integer, got a number with a fractional part": "Нужно целое число, без дробной части",
    "Input should be a valid number": "Нужно число",
    "Input should be a valid number, unable to parse string as a number": "Нужно число",
    "Input should be a finite number": "Нужно конечное число",
    "Input should be a valid boolean": "Нужно значение true или false",
    "Input should be a valid boolean, unable to interpret input": "Нужно значение true или false",
    "Input should be a valid list": "Нужен список",
    "Input should be a valid array": "Нужен массив",
    "Input should be a valid dictionary": "Нужен объект",
    "Input should be a valid dictionary or object to extract fields from": "Нужен объект",
    "Input should be an object": "Нужен объект",
    "Input should be a valid date": "Нужна дата",
    "Input should be a valid date in the format YYYY-MM-DD, {error}": "Нужна дата в формате ГГГГ-ММ-ДД ({error})",
    "Input should be a valid datetime, {error}": "Нужны дата и время ({error})",
    "Input should be a valid time, {error}": "Нужно время ({error})",
    "Input should be {expected}": "Допустимые значения: {expected}",
    "Input should be greater than {gt}": "Значение должно быть больше {gt}",
    "Input should be greater than or equal to {ge}": "Значение должно быть не меньше {ge}",
    "Input should be less than {lt}": "Значение должно быть меньше {lt}",
    "Input should be less than or equal to {le}": "Значение должно быть не больше {le}",
    "Input should be a multiple of {multiple_of}": "Значение должно быть кратно {multiple_of}",
    "String should have at least {min_length} character": "Нужно не меньше символов: {min_length}",
    "String should have at least {min_length} characters": "Нужно не меньше символов: {min_length}",
    "String should have at most {max_length} character": "Допустимо не больше символов: {max_length}",
    "String should have at most {max_length} characters": "Допустимо не больше символов: {max_length}",
    "String should match pattern '{pattern}'": "Строка не соответствует шаблону '{pattern}'",
    "List should have at least {min_length} item after validation, not {actual_length}":
        "Нужно не меньше элементов: {min_length} (сейчас: {actual_length})",
    "List should have at least {min_length} items after validation, not {actual_length}":
        "Нужно не меньше элементов: {min_length} (сейчас: {actual_length})",
    "List should have at most {max_length} item after validation, not {actual_length}":
        "Допустимо не больше элементов: {max_length} (сейчас: {actual_length})",
    "List should have at most {max_length} items after validation, not {actual_length}":
        "Допустимо не больше элементов: {max_length} (сейчас: {actual_length})",
    "Dictionary should have at most {max_length} items after validation, not {actual_length}":
        "Допустимо не больше элементов: {max_length} (сейчас: {actual_length})",
    "Input tag '{tag}' found using {discriminator} does not match any of the expected tags: {expected_tags}":
        "Неизвестный вариант '{tag}' (поле {discriminator}); допустимые: {expected_tags}",
    "Unable to extract tag using discriminator {discriminator}": "Не удалось определить вариант по полю {discriminator}",
    "JSON decode error": "Ошибка разбора JSON",
    "Value error, {msg}": "{msg}",
    "Assertion failed, {msg}": "{msg}",
}
