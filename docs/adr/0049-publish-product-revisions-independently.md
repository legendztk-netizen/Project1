# Publish Product Revisions Independently

Spec 11 replaces shared Catalog Draft and whole-Catalog Release publication for
new maintenance with immutable series and SKU revisions: manual changes apply
directly, while Excel changes are independently reviewed. The last successful
publication of an entity's complete owned-data revision wins without a stale-edit
warning, accepting that an older request approved later can replace newer values;
idempotent retries do not count as new publications.

Product activation, required assembly invalidation, and audit attribution are
atomic, while affected assembly regeneration occurs separately. This supersedes
the whole-catalog publication boundary in ADR 0019 and the rejection of stale
product proposals under ADR 003; D1 ownership, structural validation, concurrency
protection, and immutable historical business snapshots remain required.
