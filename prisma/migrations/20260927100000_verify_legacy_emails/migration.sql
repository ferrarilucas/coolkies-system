BEGIN;

UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false;

COMMIT;
