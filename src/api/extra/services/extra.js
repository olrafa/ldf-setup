'use strict';

/**
 * extra service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::extra.extra');
