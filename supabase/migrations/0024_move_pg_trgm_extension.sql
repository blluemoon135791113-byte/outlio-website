-- Keep extension-owned objects out of the exposed public API schema.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;
