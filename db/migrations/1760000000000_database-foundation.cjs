/** @type {import("node-pg-migrate").MigrationBuilderActions} */
exports.up = (pgm) => {
  pgm.createSchema("conduit", { ifNotExists: true });
  pgm.createExtension("pgcrypto", { ifNotExists: true });
};

/** @type {import("node-pg-migrate").MigrationBuilderActions} */
exports.down = (pgm) => {
  pgm.dropExtension("pgcrypto", { ifExists: true });
  pgm.dropSchema("conduit", { ifExists: true });
};
