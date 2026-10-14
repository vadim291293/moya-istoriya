# Капсулы под паролем — контрольная точка 12 октября 2026

Историческая первая версия. Ограничение списка (200) снято; добавлены зависимости и опциональный OS credential. Актуальное продолжение — [`CAPSULE_BIOMETRY_VERIFICATION.md`](CAPSULE_BIOMETRY_VERIFICATION.md). Старые результаты здесь сохранены как контрольная точка, а не финальное состояние.

Основной проект: `C:\Users\user\moya-istoriya`. Сервер: `thmzpgugjognrnqtzbqg`.

## Что сделано

Последнее уточнение владельца имеет приоритет: **нет замка до 18-летия**. Создатель семьи открывает отдельный раздел «Семья → Капсула времени» по одному дополнительному паролю. Родственники не могут просматривать, редактировать или удалять его содержимое даже с правильным паролем/токеном владельца. Новая нижняя вкладка не добавлялась.

Письмо до 8000 символов, ребёнок по желанию, до пяти фото/видео/голосовых вложений по 50 МиБ. Прежний голосовой компонент записывает до 3 минут/5 МиБ. Сохранение, редактирование, просмотр прежними увеличиваемым фото/простым видео/аудиоплеерами. Корзина — подтверждённый мягкий archive с восстановлением, без стирания оригиналов. Список первой версии — последние 200 элементов включая архив, не бесконечная лента.

## Защита и её реальные границы

- Creator соответствует текущему owner onboarding; `families` не имеет исторического creator_id. Vault owner фиксируется один раз и дополнительно сверяется с текущим owner membership. Сейчас сервер показал 10 семей с owner и ни одной с несколькими owner. Передача владельца не реализована, не расширять доступ автоматически.
- Пароль bcrypt cost 10, 8–64 символа/≤72 UTF-8 байта. Пять ошибок сохраняются сервером, затем 15 минут паузы. Успешный unlock выдаёт random 32-byte permit на 10 минут, сервер хранит его digest, новый unlock отзывает прежний.
- RPC-only private таблицы с RLS, без прямых client grants. Public wrapper invoker с пустым search_path и только authenticated/service_role EXECUTE. Definer реализации закрыты в private schema и проверяют auth.uid/owner, не user_metadata.
- AES-256-GCM до отправки: 12-byte IV, 16-byte tag. Письмо — ciphertext versioned JSON, файл — encrypted binary. Storage private `family-capsules`, не обычный family-media. Сервер проверяет связи, тип, путь, существующий объект и точный envelope size. Нет public/signed URLs/upsert, общей галереи или plaintext upload.
- Storage проверяет owner, **не парольный допуск**: owner может скачать ciphertext без допускa, но ключ выдаётся только после него. Ключ хранится на сервере; названия/связи/размеры — обычная private metadata. **Это не E2EE и не защита от администратора backend, root/debugger, сохранённых оригиналов или скриншотов.**
- При фоне/blur/unmount/смене аккаунта/семьи/роли/истечении срока UI закрывается, ключ/permit сбрасываются, owned decrypted temp удаляется. Несохранённый черновик и точная pending-операция остаются только в RAM после фона/expiry и восстанавливаются только после пароля. Выход из раздела/завершение процесса их теряют. Никаких ключей, паролей или текста в localStorage/persistent picker journal.
- Просмотр требует приватного временного plaintext файла/blob. Обычное закрытие удаляет его; crash/IO-сбой может оставить приватный cache до очистки ОС. Исходная несохранённая запись диктофона также может оставаться в app cache. Нельзя обещать forensic wipe.
- Unknown save сохраняет RAM-операцию с теми же UUID/ciphertext/files; проверка читает exact operation receipt, CAS не затирает чужую версию. Crash до подтверждения может оставить encrypted orphan upload; автоматический сборщик не установлен. После перезапуска сначала проверить серверный список, не создавать копию наугад.
- Восстановление требует отдельного signInWithPassword того же аккаунта без persist/auto-refresh и свежего signed password AMR ≤5 минут на сервере. Новый пароль раздела сохраняет прежний ключ и контент. Основная app-сессия не заменяется. Это не email-восстановление аккаунта и не новый recovery backend.

## Сервер уже развёрнут

| Версия | Миграция | Источник |
| --- | --- | --- |
| 20261012052325 | owner_password_capsules | supabase/setup/009_owner_capsules.sql |
| 20261012052612 | capsule_fk_indexes | supabase/setup/010_capsule_fk_indexes.sql |

Не повторять SQL 001–010. Нынешние данные/семейные роли/общие RLS/Storage/Auth settings не менялись. Новых реальных пользователей, семей, капсул и загруженных объектов в этом проходе не создавалось. Миграции создают схему/функции/отдельный пустой bucket/индексы, не переписывают старые записи.

`verify_capsules_rollback.sql` использовал только ранее разрешённые synthetic accounts; добавлял внутри транзакции временного относительного member, test vault и test capsule. Пройдены owner-only status/unlock/key/list/get/save/archive, правильный/неправильный пароль и persisted limiter, recent-AMR recovery с тем же AES key, idempotent create, CAS/conflict, чужой ребёнок/невалидный файл, archive/restore, запрет прямого чтения двух таблиц, Storage helper owner/member/foreign, invalidation/reset/new-device/lock и серверное expiry. Всё откатилось. После проверки: **0 vaults, 0 capsules, 0 capsule Storage objects, 0 временных членств**.

Первый тест остановился на попытке читать чужого ребёнка под owner RLS — корректное поведение. Тест исправлен: synthetic ID получен до переключения роли; повтор и расширенная expiry-проверка прошли. Не было повторного развёртывания 009 или частичных тестовых данных.

Эти SQL проверки используют действующую роль authenticated и synthetic claims, а не реальные HTTP токены. Нет фактического Storage upload/декодирования/нативного AES вызова на телефоне. Не считать их сквозным тестом мобильного приложения.

Advisors: новых WARN безопасности нет. Две новые INFO [RLS без политик](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) ожидаемы для закрытых RPC-only таблиц. Прежние WARN по [authenticated definer onboarding](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) и [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) остаются; Auth не менялся. 010 устранил новые FK index INFO; INFO unused fresh index ожидаем на пустых данных. Прежние performance warnings не исправлялись в этом этапе.

## Локальные проверки

- Первый полный прогон: **424/424** (382 прежних + 42 новых).
- После финального уточнения RAM recovery и ArrayBuffer upload: **20/20 UI** и **19/19 service**; crypto **5/5** прошли ранее, криптокод после этого не менялся. В проекте теперь 426 тестов. Старую базу не гоняли повторно после каждого небольшого изменения.
- TypeScript без ошибок. Сгенерированные Expo typed routes обновлены штатным генератором; маршруты вручную не подменялись.
- Static render — **24 сценария**: включая owner/member gate. Это не визуальная оценка телефона.
- Финальный Android JS/Hermes export — `android-owner-capsules-20261012-02`, 2002 модуля; артефакты в папке задачи Codex. **Это не установленный APK.** Экспорт 01 предшествовал последним уточнениям, ориентироваться на 02.
- Пакеты/конфигурация Windows/VPN не менялись, Metro пользователя не останавливался. Весь source — основной проект, не его новая копия.

## Следующая проверка владельцем

Перезагрузить Expo Go и пройти новый блок `docs/SMOKE_TEST.md`: письмо/фото/видео/голос, password gate, background/picker, восстановление пароля, редактирование/корзина, второй семейный аккаунт, прежние галереи. Нативное шифрование, MIME/кодеки, OS cache и настоящий HTTP upload/download **ещё требуют проверки на телефоне**.

Перед публичным релизом: пагинация капсул, серверный/Storage backup и restore drill, lifecycle/retention encrypted orphans, процедура удаления/утраты/передачи владельца, углублённый privacy/abuse audit, HTTP двухпользовательский E2E и standalone build. Не обещать столетнее хранение, forensic очистку или полностью готовый production по этим тестам.
