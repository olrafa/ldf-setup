'use strict';

/**
 * extra router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::extra.extra');
