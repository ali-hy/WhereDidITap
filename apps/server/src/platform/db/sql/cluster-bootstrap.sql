-- F-14: cluster bootstrap as a psql script, for the Postgres image's first-setup script (F-170).
-- Run as a superuser, connected to the `postgres` database:
--   BUDMON_MIGRATOR_PASSWORD='<password or SCRAM verifier>' \
--     psql -v ON_ERROR_STOP=1 -v dbname=budmon -f cluster-bootstrap.sql
-- The password is read from the environment and quoted by psql (`:'migrator_password'`), so it is
-- never in a command line or a file. Every statement is idempotent. apps/server's TypeScript
-- bootstrapCluster runs the same ones.

\getenv migrator_password BUDMON_MIGRATOR_PASSWORD
\if :{?migrator_password}
\else
  -- Stops the script (exit status 3 under ON_ERROR_STOP) before anything is changed.
  DO $$ BEGIN RAISE EXCEPTION 'BUDMON_MIGRATOR_PASSWORD is not set'; END $$;
\endif

SELECT 'CREATE ROLE budmon_migrator LOGIN CREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budmon_migrator') \gexec

ALTER ROLE budmon_migrator PASSWORD :'migrator_password';

SELECT format('CREATE DATABASE %I OWNER budmon_migrator', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec

\connect :"dbname"

ALTER SCHEMA public OWNER TO budmon_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS amcheck;
GRANT EXECUTE ON FUNCTION bt_index_check(regclass, boolean) TO budmon_migrator;
GRANT pg_read_all_data TO budmon_migrator WITH INHERIT TRUE;
GRANT pg_monitor TO budmon_migrator WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
