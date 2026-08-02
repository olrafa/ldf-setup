'use strict';

/**
 * One-off backfill for the `active` field added to equipe (team members).
 *
 * Strapi's schema-level `"default": true` only applies to new entries created
 * through the API/admin — the migration that adds the column does not
 * necessarily leave existing rows consistent across DB engines. On SQLite,
 * existing rows come out `active: null`; on Postgres (confirmed against
 * production), `ALTER TABLE ... ADD COLUMN active boolean DEFAULT true`
 * backfills existing rows to `true` immediately. So this script cannot assume
 * "already non-null" means "already correct" — it explicitly enforces:
 *   - every name in INACTIVE_NAMES -> active = false, always, even if the
 *     migration (or a prior run) already set it to true
 *   - everyone else -> active = true, but only when it's still null/undefined,
 *     so an admin's own manual choice elsewhere is never silently overwritten
 *
 * Run locally against .tmp/data.db first:
 *   npm run backfill:active
 *
 * Then, against production, run this *inside* the Fly environment:
 *   fly ssh console -a strapi-fly-1ldf -C "node scripts/backfill-active.js"
 *
 * Safe to re-run: once an entry's active value matches what's described
 * above, later runs leave it untouched. To flip someone's status later, use
 * the admin UI, not this script.
 */

const createStrapi = require('@strapi/strapi');

const INACTIVE_NAMES = ['Júlia Rugai'];

async function main() {
  const strapi = await createStrapi().load();
  const uid = 'api::equipe.equipe';

  try {
    const entries = await strapi.entityService.findMany(uid, {
      publicationState: 'preview',
      fields: ['id', 'name', 'active'],
    });

    let markedActive = 0;
    let markedInactive = 0;
    const seenNames = new Set();

    for (const entry of entries) {
      seenNames.add(entry.name);
      const isInactive = INACTIVE_NAMES.includes(entry.name);
      const desired = !isInactive;

      if (isInactive) {
        if (entry.active === false) continue; // already correct
      } else if (entry.active !== null && entry.active !== undefined) {
        continue; // leave any admin-set value alone, only fill in unset ones
      }

      await strapi.entityService.update(uid, entry.id, { data: { active: desired } });

      if (isInactive) {
        markedInactive += 1;
      } else {
        markedActive += 1;
      }
    }

    const unmatchedInactiveNames = INACTIVE_NAMES.filter((n) => !seenNames.has(n));
    if (unmatchedInactiveNames.length > 0) {
      strapi.log.warn(
        `[backfill-active] no equipe entry matched these INACTIVE_NAMES (check spelling/accents): ${unmatchedInactiveNames.join(', ')}`
      );
    }

    strapi.log.info(
      `[backfill-active] equipe: ${markedActive} entr${markedActive === 1 ? 'y' : 'ies'} set active=true, ${markedInactive} set active=false`
    );
  } finally {
    await strapi.destroy();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
