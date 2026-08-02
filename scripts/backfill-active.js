'use strict';

/**
 * One-off backfill for the `active` field added to equipe (team members).
 *
 * Strapi's schema-level `"default": true` only applies to new entries created
 * through the API/admin — it does not retroactively set existing rows, which
 * come out of the migration as `active: null`. Since the frontend's team page
 * is meant to show active members by default, every pre-existing entry needs
 * `active` explicitly set to `true`, except the ones we intentionally mark
 * inactive (see INACTIVE_NAMES below).
 *
 * Run locally against .tmp/data.db first:
 *   npm run backfill:active
 *
 * Then, against production, run this *inside* the Fly environment:
 *   fly ssh console -a strapi-fly-1ldf -C "node scripts/backfill-active.js"
 *
 * Safe to re-run: entries that already have `active` set (true or false) are
 * left untouched, so INACTIVE_NAMES only takes effect on an entry's first run
 * through this script. To flip someone's status later, use the admin UI.
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
      if (entry.active !== null && entry.active !== undefined) continue; // already set

      const isInactive = INACTIVE_NAMES.includes(entry.name);
      await strapi.entityService.update(uid, entry.id, { data: { active: !isInactive } });

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
