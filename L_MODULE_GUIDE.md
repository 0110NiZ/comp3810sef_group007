# Animal registration and editing

The L module is integrated with shared authentication, rescue and adoption workflows.
Follow README.md for setup. Do not apply older standalone branch patches.

- server.js section 02: animal create, read and edit routes.
- models/Animal.js: shared fields and indexes.
- views/create.ejs, animal-fields.ejs, edit.ejs and details.ejs: forms and details.
- npm test: real login, CRUD, stale editing, permissions and related workflow checks.

The legacy test-l-animal.js entry point runs the shared test suite. Closed animal records
are read-only for all roles. Database IDs and animal codes remain stable.
