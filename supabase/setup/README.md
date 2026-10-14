# Supabase setup for memories and private media

## Deployed bounded capsule reads — 12 October 2026

Already applied to **thmzpgugjognrnqtzbqg**: `20261012074944 capsule_cursor_pagination`, reviewed source `011_capsule_pagination.sql`. **Do not rerun SQL 001–011.** New public SECURITY INVOKER `list_family_capsules` (authenticated/service_role only), checked private implementation reusing the existing frozen/current owner + password permit, and `(family_id, archived, updated_at DESC, id)` index. 30 rows + sentinel, archive filter before keyset pagination, exact timestamp/UUID cursor. No keys in list results, no change to existing rows, password recovery, owner rights, Storage/Auth configuration or general table grants.

`../checks/verify_capsule_pages_rollback.sql` passed: 207 active through eight pages, five archived, ties/cursors/denied member and foreign family/wrong or expired token. All synthetic rows and temporary membership rolled back; fixture counts zero afterwards. These SQL claim simulations are not real HTTP JWT validation. Anonymous REST endpoint probe additionally returned 401/42501 without rows.

The optional native biometric credential is a client-only feature and **does not replace server owner/password authorization** or require schema changes. After the user's disappearance report, read-only real-project counts found one vault and one active saved capsule; content/keys/passwords were not read. No data was deleted to resolve that report. Latest contract/testing limits: `../../docs/CAPSULE_BIOMETRY_VERIFICATION.md`.

## Deployed owner-only password capsules — 12 October 2026

Already applied to **thmzpgugjognrnqtzbqg** through MCP:

| Server version | Migration | Reviewed source |
| --- | --- | --- |
| 20261012052325 | owner_password_capsules | 009_owner_capsules.sql |
| 20261012052612 | capsule_fk_indexes | 010_capsule_fk_indexes.sql |

**Do not rerun SQL 001–010.** These are reviewed deployment sources, not locally generated CLI migrations. No existing user rows, family roles, Auth settings or ordinary gallery policies were changed.

The product owner replaced the earlier age-18 seal with an owner-only section protected by one extra password, with no opening date. Private RPC-only RLS tables, checked public invoker wrapper, current/frozen owner checks, bcrypt limiter, 10-minute hashed permits and password recovery via a fresh signed password AMR. Separate private ciphertext bucket (50 MiB + 32 bytes). Its RLS denies members even if they know the vault password. Storage permits owner ciphertext access, not plaintext; only the password-gated RPC releases the AES key. This is server-managed encryption, **not E2EE**. Metadata titles are not encrypted. Schema/owner transfer/delete/recovery and long-term backups need their own design before release.

`../checks/verify_capsules_rollback.sql` passed with the two already approved synthetic users, including a temporary relative membership, owner/member isolation, password counter, recovery retaining the key, CAS/idempotence, trash/restore and server-side expiry. Every test row rolled back; counts of vaults, capsules, uploaded objects and temporary membership were zero afterwards. No new Auth users/families or actual Storage uploads. SQL claims simulate authorization, not real HTTP JWT verification or device encryption.

Security advisors: two new INFO `rls_enabled_no_policy` entries are intentional for inaccessible RPC-only tables; pre-existing WARN remain unchanged. New FK index INFO were addressed by 010; an unused fresh index INFO is expected on empty data. Details and phone checks: `../../docs/CAPSULE_VERIFICATION.md`.

## Deployed diary voice — 10 October 2026

Both sources are **already deployed to `thmzpgugjognrnqtzbqg` through MCP migrations**; do not rerun SQL 001–008:

| Server version | Migration | Reviewed source |
| --- | --- | --- |
| 20261010090041 | diary_voice | 007_diary_voice.sql |
| 20261010090308 | voice_aware_editing | 008_voice_aware_editing.sql |

007 extends `media_files` to audio, constrains audio MIME/metadata size (5 MiB), adds a partial unique index for one voice per memory and appends audio/mp4 + audio/webm to the existing private bucket's MIME allowlist. Its existing total bucket limit stays 50 MiB. The existing invoker `create_family_memory` signature/endpoint remains compatible: voice only in diary, text still required, visual attachments only in skills. No new table/endpoint, no user-row rewrite, no RLS/Auth changes or general write grants.

008 changes only the visual-media aggregation inside the existing checked private CAS editor. A voice-only diary entry remains note after edits. Its author/owner validation, membership checks, locks, expected snapshot and version increment remain unchanged.

`../checks/verify_voice_rollback.sql` passed: all categories, edit, archive/restore, cross-family denial, invalid audio/duplicate rejection. The earlier `verify_diary_rollback.sql` also passed after these migrations, including old eight-argument calls. All temporary rows rolled back; subsequent count was zero. These are metadata/RLS tests, not real microphone, Storage audio-byte upload, decoder or HTTP token tests. No new Auth users/families/Storage objects were created in this stage. Details and remaining advisories: `../../docs/VOICE_POSTER_VERIFICATION.md`.

## Deployed diary — 10 October 2026

`006_diary_categories.sql` was applied through MCP as **20261010072842 diary_categories** to `thmzpgugjognrnqtzbqg`. Do not rerun. It adds nullable diary metadata, CHECKs and a partial index; existing rows stay NULL. `create_family_memory` now has one nine-argument signature with a default NULL last parameter, preserving old eight-argument calls. SECURITY INVOKER, empty search_path, explicit authenticated/service_role EXECUTE, no PUBLIC/anon EXECUTE. Existing RLS, Storage and Auth settings remain unchanged.

`../checks/verify_diary_rollback.sql` passed with effective authenticated roles of the already approved synthetic accounts: categories, old calls, media, edit/restore and cross-family isolation. All temporary rows rolled back; no new Auth users or uploaded objects. Client contract and phone checks: `../../docs/DIARY_VIDEO_VERIFICATION.md`.

`001_memories_and_private_media.sql` is a one-time, manually reviewed setup script. It is **not** a Supabase migration. It was applied to the live `moya-istoriya` project on 7 October 2026 after the project owner's approval. Do not run it again: its preflight checks intentionally stop when the memory tables or bucket already exist.

It is intended for the inspected `moya-istoriya` project, where the four core family tables and their read RLS policies already exist, while memory tables and Storage buckets do not. The script stops before doing work if those assumptions no longer hold. It adds the missing authenticated `SELECT` grants for the existing RLS-protected core tables, adds the memory/media tables and policies, and creates the private `family-media` bucket with the currently available 50 MB per-file limit.

The SQL application reported success. On 7 October 2026, a separately approved authenticated check created two explicitly synthetic test accounts, families, memories and PNG files and passed 51 checks for owner access, cross-family isolation, anonymous denial and repeat login. See `../../docs/LIVE_SUPABASE_VERIFICATION.md` for the retained fixture IDs and the limitations; this does not prove physical-device flows or shared-family roles. Do not rerun the test or delete its fixtures without separate approval. The Data API allowlist was separately restricted to the endpoints needed by the app. The bucket stays private. Do not make it public or use a service-role key in the app.

The Storage `SELECT` policy includes a narrow exception for an uploader's own pending object in one of their family folders. Supabase's upload API returns the new object row, so an `INSERT` policy alone is not sufficient; after the memory metadata row exists, family reads are authorized through the linked `media_files` row. Pending-object access is needed for the upload response and failure cleanup, not as a public link.

The script only covers adding and reading memories/media. Editing/deleting memories and invitation/role management need separate policy and UI work. Future deletion needs a recoverable protocol for both database metadata and Storage: deleting the files first can break an existing memory if the database operation fails. No deletion workflow is implemented by these scripts.

`002_idempotent_family_setup.sql` was separately approved and applied on 7 October 2026. It changes only the existing onboarding function: per-user transaction locking and returning an existing child make repeated onboarding calls safe without creating another family. It does not add a global one-family constraint or alter memberships. Authenticated execution, anonymous denial, the lock and an empty search path were verified with read-only metadata queries. The separately approved live check also confirmed that two concurrent repeat calls return the existing child and leave one membership for each test user.

The local memory journal is written before calling `create_family_memory`. After the RPC starts, its outcome is reconciled by the exact memory UUID; the client does not compensate by deleting uploaded media when a response is lost. A retry reuses the same submission. A crash before the journal is written can still leave private unlinked uploads; no automated orphan collection is installed.

## Deployed family access, editing and trash — 9 October 2026 (Moscow)

003/004/005 are reviewed deployment sources, **already applied to thmzpgugjognrnqtzbqg through Supabase MCP migrations**. Do not rerun them or SQL 001/002. Fresh metadata was reviewed before deployment. Unlike 001/002, these changes are tracked in the server migration history:

| Version (server) | Migration | Local source |
| --- | --- | --- |
| 20261008203224 | edit_memory_details | 003 |
| 20261008210215 | family_invitation_table | 004: private invitation table |
| 20261008210438 | family_invitation_access_rpcs | 004: invitation/access functions |
| 20261008210515 | memory_recoverable_deletion_schema | 004: lifecycle columns, receipts, RLS/Storage guards |
| 20261008210518 | memory_lifecycle_rpcs | 004: archive/restore/trash functions and editing version increment |
| 20261008210637 | close_unused_privileged_endpoints | Revokes direct execution of handle_new_user/create_family; trigger remains enabled |
| 20261008214030 | membership_scoped_revocation_endpoint | 005: revoke a specific membership UUID |
| 20261008214052 | close_user_scoped_revocation | 005: closes superseded remove_family_member in both schemas |

Large source bundles sometimes failed with `Invalid or expired requestState`. Read-only checks confirmed no deployment before retry; smaller feature migrations reported success, and subsequent metadata/rollback tests confirmed them. The technical root cause was not established. Do not switch to untracked SQL execution to bypass connector approvals/errors.

003 implements a private checked SECURITY DEFINER implementation with an authenticated public SECURITY INVOKER wrapper. It edits title/body/event date/child links atomically, accepts exact expected/desired snapshots and rejects conflicting writes. It does not grant general UPDATE/DELETE.

004 adds one-use, seven-day invitations (32 random bytes; server stores only SHA-256), owner-only access management, recoverable memory deletion, a versioned operation receipt, and protected linked Storage originals. Private tables have RLS, no client table grants/policies and are reached only through checked RPCs. Public wrappers receive explicit authenticated EXECUTE; anonymous calls remain denied. Data API grant-based publication was confirmed; private schemas/tables and profiles were not opened.

005 replaces user-scoped revocation with membership-scoped revocation. A replay cannot remove a different membership created after deliberate rejoining. Accounts/authored records/files/children are preserved. The old endpoint has no anon/authenticated execution grant.

`../checks/verify_memory_editing_rollback.sql` and `../checks/verify_family_access_trash_rollback.sql` passed with effective authenticated roles for the two already approved synthetic accounts; temporary rows all rolled back. They do not create Auth users or upload objects. See `../../docs/FAMILY_ACCESS_AND_TRASH_VERIFICATION.md` for UI checks, native/API limitations, signed-link expiry and backup caveats.
