'use strict';

/**
 * One-off backfill for the `title`/`slug` fields added to book/record/film/convidado.
 *
 * Run locally against .tmp/data.db first:
 *   npm run backfill:slugs
 *
 * Then, against production (Fly.io Postgres), run this *inside* the Fly
 * environment so it picks up DATABASE_URL/DATABASE_* from the machine's env,
 * e.g.:
 *   fly ssh console -a strapi-fly-1ldf -C "node scripts/backfill-slugs.js"
 *
 * Safe to re-run: entries that already have title/slug set are left untouched.
 */

const createStrapi = require('@strapi/strapi');

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(base, usedSlugs, ownId) {
  const collided = usedSlugs.has(base);
  const slug = collided ? `${base}-${ownId}` : base;
  usedSlugs.add(slug);
  return { slug, collided };
}

/**
 * Backfills `title` (copied from the related `obra.title`) and `slug` for a
 * content type whose entries reference an `obra` via a `reference` relation
 * (book, record, film). Each row is its own logical entry — `reference` is
 * not unique, so two different articles legitimately can point at the same
 * obra, and must still get distinct slugs.
 */
async function backfillReferencedType(strapi, uid, label) {
  const entries = await strapi.entityService.findMany(uid, {
    publicationState: 'preview',
    populate: ['reference'],
    fields: ['id', 'title', 'slug'],
  });

  const usedSlugs = new Set(entries.filter((e) => e.slug).map((e) => e.slug));

  let updated = 0;
  let collisions = 0;
  const missingReference = [];

  for (const entry of entries) {
    if (entry.title && entry.slug) continue; // already backfilled
    if (!entry.reference) {
      missingReference.push(entry.id);
      continue;
    }

    const title = entry.reference.title;
    const base = slugify(title);
    const { slug, collided } = uniqueSlug(base, usedSlugs, entry.id);
    if (collided) collisions += 1;

    await strapi.entityService.update(uid, entry.id, { data: { title, slug } });
    updated += 1;
  }

  if (missingReference.length > 0) {
    strapi.log.warn(
      `[backfill-slugs] ${label}: ${missingReference.length} entr${
        missingReference.length === 1 ? 'y has' : 'ies have'
      } no "reference" set, needs a manual title in the admin: ids ${missingReference.join(', ')}`
    );
  }

  strapi.log.info(
    `[backfill-slugs] ${label}: updated ${updated} row(s) (${collisions} slug collision(s) resolved)`
  );
}

/** Backfills `slug` for convidado, generated from its own `name` field. */
async function backfillConvidados(strapi) {
  const uid = 'api::convidado.convidado';
  const entries = await strapi.entityService.findMany(uid, {
    publicationState: 'preview',
    fields: ['id', 'name', 'slug'],
  });

  const usedSlugs = new Set(entries.filter((e) => e.slug).map((e) => e.slug));

  let updated = 0;
  let collisions = 0;

  for (const entry of entries) {
    if (entry.slug) continue; // already backfilled

    const base = slugify(entry.name);
    const { slug, collided } = uniqueSlug(base, usedSlugs, entry.id);
    if (collided) collisions += 1;

    await strapi.entityService.update(uid, entry.id, { data: { slug } });
    updated += 1;
  }

  strapi.log.info(
    `[backfill-slugs] convidado: updated ${updated} row(s) (${collisions} slug collision(s) resolved)`
  );
}

async function main() {
  const strapi = await createStrapi().load();

  try {
    await backfillReferencedType(strapi, 'api::book.book', 'book');
    await backfillReferencedType(strapi, 'api::record.record', 'record');
    await backfillReferencedType(strapi, 'api::film.film', 'film');
    await backfillConvidados(strapi);
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
