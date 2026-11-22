# Animal Rescue Center — Animal Rescue & Adoption

COMP3810SEF Group 007. Internal staff workspace using Express, EJS and MongoDB/Mongoose.
Routes and business logic remain in server.js; models, views and assets remain in their
course-standard folders. No public registration or built-in passwords.

## Team responsibilities

| Member | Responsibilities |
| --- | --- |
| T | Authentication, profile/password, active accounts and team administration |
| L | Animal creation, details and basic editing |
| Y | Dashboard, filtering, pagination and shared UI |
| M | Rescue assignment, placement and follow-ups |
| N | Adoption, cancellation, closure, deletion and audit |

Add actual member names and student IDs before submission; these details must be supplied
by the team. Keep accurate authorship and assistance disclosures where required.

## Setup

Use Node.js 24 LTS. Run `npm ci`, copy `.env.example` to `.env`, and set MONGODB_URI to the
Atlas URI including the database name animal_rescue_group007. URL-encode reserved characters
in the database password. Add your connecting IP to the Atlas access list. Web accounts
are separate from Atlas database users. Never commit .env, credentials or cookie files.

Run `npm start` and open http://127.0.0.1:8099. HOST and PORT can override the binding.
Production requires HTTPS and SESSION_KEYS (comma-separated keys of at least 32 characters).
Set TRUST_PROXY=1 only behind exactly one trusted reverse proxy. Development session keys
are temporary, so restarting signs out existing sessions unless stable keys are supplied.

Existing staff01 and admin01 retain their passwords. To initialise a new administrator:

```bash
read -rsp "Initial administrator password: " ADMIN_PASSWORD; printf '\n'
printf '%s' "$ADMIN_PASSWORD" | node --env-file-if-exists=.env server.js --create-admin
unset ADMIN_PASSWORD
```

This creates admin01 only if absent. ADMIN_USERNAME overrides the name. Existing accounts
are never overwritten. Administrators create staff in Team Accounts. Staff can change their
own display name, phone and password. Team Accounts enables/disables staff without deleting
historical references; administrator accounts are protected from disabling here.

## Database and migration

Use Atlas or a local replica set. A standalone MongoDB cannot support the required
transactions. For a local test replica set, install mongod and mongosh, then run:

```bash
mkdir -p /tmp/group007-test-db
mongod --replSet group007rs --bind_ip 127.0.0.1 --port 27018 --dbpath /tmp/group007-test-db --logpath /tmp/group007-test-db/mongod.log --fork
mongosh --port 27018 --eval 'rs.initiate({_id:"group007rs",members:[{_id:0,host:"127.0.0.1:27018"}]})'
```

Startup creates declared indexes. It replaces only the legacy full unique adoption animalId_1
index with one_current_adoption, a partial unique index for uncancelled registrations. Other
indexes and business data are retained. Missing isActive fields become true. Only the known
original display names of staff01/admin01 become Staff 01/Administrator 01; custom names stay
unchanged. Historical animal descriptions, ObjectIds, animal codes and stored enum values
are preserved. Migration is safe to repeat.

Every rescue/follow-up/adoption mutation locks the same animal in a transaction. Follow-up
changes advance animals.updatedAt. Concurrent closure/deletion cannot leave orphan notes or
allow writes to closed records. No sample records are inserted at startup.

## Workflow and permissions

Staff can register animals, read records, claim unassigned cases for themselves, and add
follow-ups under their own names. Authors can edit their open-case follow-ups.
Only administrators may delete an incorrect follow-up. On open cases, the coordinator or an administrator
can edit animal details, update rescue progress and placement, manage adoption and close
the case. Administrators can assign or hand over cases, manage staff access, correct any
follow-up and delete incorrect open animal records
with a reason and audit trail. Closed records are read-only for BOTH roles. Disabled users
lose access on their next request and cannot sign in; historical references remain intact.

Rescue progresses pending → rescuing → placed. Rescuing/placed require an assignee; placed
requires a location. Opening adoption requires placement and human health confirmation.
Register → edit or cancel → re-register if needed → complete handover and close. Cancellation
retains its reason/operator/time and returns the animal to available. Closing updates the
animal and adoption together. Deletion removes associated records within the same transaction
and retains a separate audit log.

## API contract

All business APIs require a session cookie. Mutations require X-CSRF-Token. Obtain the token
from GET /api/csrf, then obtain a fresh token after login (login rotates it).
Success: {"success":true,"data":...}. Failure: {"success":false,"error":{"code":"...","message":"..."}}.
Follow-up list/create/edit now use this same envelope.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/csrf | Issue security token |
| POST | /api/login, /api/logout | Sign in/out |
| GET, PUT | /api/profile | Read/update displayName and phone |
| PUT | /api/password | currentPassword, newPassword, confirmPassword |
| GET, POST | /api/users | Administrator list/create staff |
| PUT | /api/users/:id/status | Set staff isActive boolean |
| GET | /api/stats | Rescue/adoption counts and recent records |
| GET, POST | /api/animals | Search/register animals |
| GET, PUT, DELETE | /api/animals/:id | Read/edit/delete animal |
| PUT | /api/animals/:id/rescue | Update rescue progress and placement |
| PUT | /api/animals/:id/claim | Take an unassigned case for yourself (expectedUpdatedAt) |
| PUT | /api/animals/:id/assign | Administrator dispatch or handover (assignedTo, expectedUpdatedAt) |
| GET, POST | /api/animals/:id/followups | List/create follow-ups |
| PUT, DELETE | /api/animals/:id/followups/:followId | Edit/delete follow-up |
| GET, POST, PUT | /api/animals/:id/adoption | Read/register/edit adoption |
| PUT | /api/animals/:id/adoption-status | available or not_open |
| PUT | /api/animals/:id/adoption/cancel | Cancel adoption |
| PUT | /api/animals/:id/close | Complete adoption and close |

Animal editing accepts six basic fields. Animal, rescue and follow-up edit/delete
REQUIRE expectedUpdatedAt from the latest record; stale versions return 409 and missing/invalid
versions return 400. Adoption edit/cancel/close require adoptionId and adoptionVersion from the
latest GET adoption result. Do not generate these values yourself. Opening adoption requires
healthConfirmed:true. Cancellation requires confirm:true and cancellationReason; deletion
requires confirm:true and deletionReason; closure requires confirm:true.

Animal query fields: animalType, foundLocation, rescueStatus, adoptionStatus, dateFrom, dateTo,
sort, page. Dates use YYYY-MM-DD inclusive Hong Kong days. Page size is 10, matching the paginated workspace lists. Sort accepts
updated_desc, updated_asc, created_desc and created_asc. Date, page and enum values are validated.

## Curl demonstration

Run these operations against a disposable test environment. Requires curl and Node.js.
Supply a staff or administrator password locally, not in this file.

```bash
BASE=http://127.0.0.1:8099
COOKIE_FILE=$(mktemp)
TOKEN=$(curl -s -c "$COOKIE_FILE" "$BASE/api/csrf" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.csrfToken')
read -rp "Username: " LOGIN_USER
read -rsp "Password: " LOGIN_PASSWORD; printf '\n'
export LOGIN_USER LOGIN_PASSWORD
node -e 'process.stdout.write(JSON.stringify({username:process.env.LOGIN_USER,password:process.env.LOGIN_PASSWORD}))' | curl -s -b "$COOKIE_FILE" -c "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' --data-binary @- "$BASE/api/login"
unset LOGIN_USER LOGIN_PASSWORD
TOKEN=$(curl -s -b "$COOKIE_FILE" -c "$COOKIE_FILE" "$BASE/api/csrf" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.csrfToken')
curl -s -b "$COOKIE_FILE" "$BASE/api/animals"
CREATED=$(curl -s -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"animalType":"cat","appearance":"API test cat","foundLocation":"Test shelter","healthStatus":"Pending assessment","contactName":"Test Contact","contactPhone":"00000000"}' "$BASE/api/animals")
ANIMAL_ID=$(printf '%s' "$CREATED" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data._id')
VERSION=$(printf '%s' "$CREATED" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.updatedAt')
export VERSION
node -e 'process.stdout.write(JSON.stringify({animalType:"cat",appearance:"Updated test cat",foundLocation:"Test shelter",healthStatus:"Assessed",contactName:"Test Contact",contactPhone:"00000000",expectedUpdatedAt:process.env.VERSION}))' | curl -s -X PUT -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' --data-binary @- "$BASE/api/animals/$ANIMAL_ID"
# Deletion succeeds only for an administrator and an open record.
curl -s -X DELETE -b "$COOKIE_FILE" -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' -d '{"confirm":true,"deletionReason":"Disposable API test"}' "$BASE/api/animals/$ANIMAL_ID"
rm -f "$COOKIE_FILE"
unset VERSION
```

## Animal registration and editing module

Animal create, read and edit routes are in server.js section 02. The schema and
indexes are in models/Animal.js. The related views are create.ejs,
animal-fields.ejs, edit.ejs and details.ejs. These share authentication, rescue
and adoption workflows; do not apply older standalone module patches.
Closed records remain read-only for all roles. Both web and API edits require
expectedUpdatedAt; missing/invalid versions return 400 and stale versions return 409.

## Submission

Submit server.js, package files, README, models, views and public assets. Exclude node_modules,
.env, cookies, local database files and temporary screenshots. Source must remain readable,
with indented multi-line EJS, JavaScript and CSS. Keep licences and accurate attribution.


### Animal reference codes

Animal codes use `AR-YYYY-NNNN`, for example `AR-2026-0001`. The year follows
Hong Kong time. A database counter allocates unique numbers across concurrent
registrations; numbers are never reused and gaps are allowed after failed requests.
The sequence can grow beyond four digits.

Database initialization migrates legacy codes in registration order. This is
idempotent and also reserves codes in deletion history. MongoDB `_id` values,
relationships, record versions and timestamps remain unchanged. The
`animal_code_migrations` collection retains the old/new code mapping.
A replica set is required, as for existing adoption transactions.

To explicitly run the migration using the local connection configuration:

```sh
node --env-file=.env scripts/migrate-animal-codes.js
```

## Third-party visual assets

The pixel artwork is sourced from third-party creators, not presented as artwork
made by group members. Kenney Tiny Town supplies the scenery, Kenney Pixel UI Pack
supplies panel borders (both CC0), bluecarrot16 supplies the cats and dogs (CC BY
3.0), and Gerrit Halfmann's Pixelarticons supplies interface icons (MIT).

See [the asset attribution register](public/assets/README.md) for original links,
selected licenses, modifications and the included license files. Artwork is served
locally. SVG wrappers arrange existing assets; they do not claim original artwork.

The `services/animal-codes.js` module provides sequential display codes; the
`scripts/migrate-animal-codes.js` utility migrates legacy codes. MongoDB `_id`
references stay unchanged. The Atlas `one_current_adoption` partial unique index
allows at most one non-cancelled adoption per animal, including completed adoptions.

### Animal lookup and follow-up dates

Animal Records accepts a complete animal code, including lowercase input. The
same filter is available on `GET /api/animals?animalCode=AR-2026-0001`.
Follow-up forms and API writes accept an optional `nextFollowUpDate` in
`YYYY-MM-DD` format. The newest entry sets the schedule for an open animal.
Leaving its date blank clears the reminder. Omitting the field in an API
edit preserves its previous value. The dashboard shows due and overdue
follow-ups using the Hong Kong calendar date.
