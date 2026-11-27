# Animal Rescue and Adoption Management System

COMP3810SEF | Autumn 2026 | Group 007

## 1. Project Information

We made this website for staff at an animal rescue center. It helps them record animals, arrange rescue and placement, add care notes and handle adoption. Each animal gets a reference code, so staff can find the same case later.

Staff and administrators have different permissions. Staff can take unassigned cases and manage the cases they are responsible for. Administrators can also manage staff accounts, hand over cases and delete incorrect open records.

We use **Node.js, Express.js, EJS and MongoDB with Mongoose**. The webpages and REST API work with the same database.

Repository: https://github.com/0110NiZ/comp3810sef_group007

## 2. Group Information

| Member | Name | SID | Main work |
| --- | --- | --- | --- |
| T | TANG Wanqiao | 13339703 | Login, logout, profiles, passwords and staff accounts |
| L | LIN Keying | 13405317 | Animal registration, details, editing and input checks |
| Y | YAN Xiyu | 13387657 | Dashboard, search, filters, sorting, pagination and shared UI |
| M | MAI Zilin | 13393467 | Case claiming and handover, rescue progress, placement and follow-ups |
| N | NIE Zhidan (Team leader) | 13255894 | Adoption, cancellation, case closure, deletion and deletion logs |

## 3. Project Files

| File or folder | What it does |
| --- | --- |
| `server.js` | Starts the Express server and handles login, permissions, webpage routes and API requests. |
| `package.json` and `package-lock.json` | List the dependencies and commands used to start and test the project. Main dependencies are `express`, `ejs`, `mongoose` and `cookie-session`. |
| `models/` | MongoDB models for users, animals, follow-ups, adoptions and deletion logs. `constants.js` contains the status labels. |
| `views/` | EJS pages for login, the dashboard, animal records, rescue, follow-ups, adoption and accounts. |
| `public/` | CSS, browser JavaScript, date pickers, icons and images. |
| `services/` | Helpers for animal codes, phone numbers and database configuration. |
| `scripts/` | Animal-code migration and test files. |
| `.env.example` | An example of the settings needed to run the server. |
| `docs/REST_API_FULL_CHECKS.md` | Extra copy-and-run commands for the full API, including rescue, follow-ups and adoption. |

We use Kenney assets (CC0), bluecarrot16's cat and dog artwork (CC BY 3.0), and Pixelarticons (MIT). These are third-party assets. Their sources and licenses are listed in [public/assets/README.md](public/assets/README.md).

## 4. Operation Guide

### 4.1 Start the project

Use **Ubuntu or WSL**, **Node.js 24**, npm and MongoDB. The database must be a replica set or Atlas because some operations update several records together.

**Normal startup**

Once the dependencies are installed, `.env` is configured and the database is running, start the website with:

```bash
cd ~/comp3810sef_group007
npm start
```

Open **http://127.0.0.1:8099/login** after the database connection message appears. Existing accounts and records stay in the database, so they do not need to be created again each time.

**First-time setup**

Complete the following setup only when preparing a new environment. `npm ci` installs dependencies; `npm start` starts the application.

For a new local demo, install `mongod` and `mongosh`, then run:

```bash
mkdir -p "$HOME/group007-demo-db"
mongod --replSet group007rs --bind_ip 127.0.0.1 --port 27018 \
  --dbpath "$HOME/group007-demo-db" --logpath "$HOME/group007-demo-db/mongod.log" --fork
mongosh --port 27018 --eval 'rs.initiate({_id:"group007rs",members:[{_id:0,host:"127.0.0.1:27018"}]}); while(!db.hello().isWritablePrimary){sleep(100)}'
```

Initialize the replica set only once. If it is already running, use it without running `rs.initiate` again.

In the project folder, install the dependencies and prepare `.env`:

```bash
cd ~/comp3810sef_group007
npm ci
cp -n .env.example .env
```

Set these values in `.env` for the separate local demo database:

```dotenv
CONNECT_DB=1
MONGODB_URI=mongodb://127.0.0.1:27018/animal_rescue_group007_demo?replicaSet=group007rs
HOST=127.0.0.1
PORT=8099
```

For the first run, create the local demo administrator and start the app:

```bash
export MONGODB_URI='mongodb://127.0.0.1:27018/animal_rescue_group007_demo?replicaSet=group007rs'
export CONNECT_DB=1
printf '%s' 'Arc-Admin-007-demo' | ADMIN_USERNAME=demo_admin007 node --env-file-if-exists=.env server.js --create-admin
npm start
```

The initialization command does not change an existing account. After this first-time setup, use the normal startup commands above.

The server requires a database name in the connection URI and rejects the database named `test`. The startup message shows which database it is using.

### 4.2 Login and roles

Create these accounts only in the local demo database above. They are not added automatically when the server starts.

| Role | Username | Local demo password | Setup |
| --- | --- | --- | --- |
| Administrator | `demo_admin007` | `Arc-Admin-007-demo` | Created by the command in 4.1. |
| Staff | `demo_staff007` | `Arc-Staff-007-demo` | The administrator creates it in **Team Accounts -> Create Staff Account**. Enter a display name and this initial password, then click **Create Account**. |

Enter the username and password and click **Sign in**. Click **Sign Out** in the sidebar to log out. **My Account** lets users edit their profile, change their password and see their assigned cases and recent notes.

- **Staff:** register and search animals, take unassigned cases, manage their own cases, and add follow-ups. They can edit their own notes while the case is open.
- **Administrator:** also create, enable or disable staff accounts, assign or hand over cases, and delete incorrect open animal records or follow-ups.
- **Closed cases:** read-only for everyone, including administrators. Staff accounts can be disabled, but there is no account-delete function.

The passwords above are public examples for the isolated local demo only. Do not use them in shared Atlas or production. Keep real database credentials, session keys and `.env` out of GitHub and the submission. For a public deployment, use private credentials, HTTPS and stable `SESSION_KEYS`.

### 4.3 Using the website

| Function | How to use it |
| --- | --- |
| **Register an animal** | Open **Add Animal**, fill in the animal type, appearance, location, health condition and contact details, then click **Register Animal**. The details page shows the generated animal code. |
| **Search and read** | Open **Animal Records**. Search by the complete animal code or combine filters such as type and found location. Click **Search**, then **View Details** in the result row. Use **Reset** to clear the filters. Sorting and pagination are also available; each page shows up to 10 records. |
| **Claim and edit** | For an open, unassigned case, click **Take case** in the details Overview. After claiming it, use **Back to Details -> Edit Details**, change the information and click **Save Changes**. |
| **Assign and hand over** | As admin, open an unfinished animal's **Overview**. For an unassigned case, click **Assign coordinator**, choose an active user and submit. For an assigned case, click **Manage Rescue**, then use **Hand over case** to choose and confirm the new coordinator. |
| **Record placement** | In **Manage Rescue**, select the rescue progress, enter the placement location when needed and click **Save Rescue Changes**. The details page shows the saved values. |
| **Add a follow-up** | Open **Care Journal -> Add Follow-up**, enter notes and an optional next follow-up date, then click **Save Follow-up**. Follow-up Records also has All Entries and My Entries views. |
| **Open adoption** | Once the animal is placed, open **Adoption Management**, tick the health confirmation and click **Open for Adoption**. On the Available list, click **Register Adopter**. |
| **Register and edit adoption** | Enter the adopter's details and click **Register Adoption**. From the In Progress list, click **Continue Application** to edit the details and use **Save Adoption Changes**. |
| **Cancel or withdraw** | **Cancel This Adoption** requires a reason and confirmation. The animal becomes available again, and the cancelled application stays in its history. Before an application is registered, **Withdraw Availability** returns the animal to Not Open. |
| **Complete adoption** | Click **Complete Adoption**, check the details, tick the handover confirmation and click **Complete Adoption & Close Case**. The record is then read-only. |
| **Delete an incorrect record** | As admin, open a separate unfinished test animal's **Overview -> Record Administration -> Delete Incorrect Record**. Give a reason, tick confirmation and click **Confirm Deletion**. Related follow-ups/adoptions are deleted together, while a deletion log is kept. |
| **Manage staff access** | In **Team Accounts**, click **Disable Account** or **Enable Account** beside a staff account. Disabled staff cannot sign in or continue using an old session. |

**Edit Details** is shown only to the current coordinator or an administrator, and only while the case is open. Creating a record does not automatically assign it to its creator.

Rescue progress cannot go backwards. A case can move directly from Pending Rescue to Placed if it has an active coordinator and a placement location. The animal must be placed and its health confirmed before adoption can be opened.

For phone numbers, choose `+852` and enter 8 digits, or choose `+86` and enter 11 digits. The number is saved with the calling code.

The dashboard shows due and overdue follow-ups using Hong Kong dates. The newest-created follow-up decides the next date. If it has no next date, there is no reminder. Closed cases do not show reminders.

### 4.4 REST API

The API returns JSON. Most successful responses use `{"success":true,"data":...}`; some actions return a success message. Errors use `{"success":false,"error":{"code":"...","message":"..."}}`.

Business APIs require a login cookie. All POST, PUT and DELETE requests need an `X-CSRF-Token`. Get the token before login, and get a new one after login or a password change. The API `:id` uses a MongoDB `_id`, not the displayed animal code.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/csrf` | Get a CSRF token |
| POST | `/api/login`, `/api/logout` | Log in or out |
| GET / PUT | `/api/profile` | Read or update the current user's profile |
| PUT | `/api/password` | Change the current user's password |
| GET / POST | `/api/users` | Admin lists accounts or creates staff |
| PUT | `/api/users/:id/status` | Admin enables or disables staff |
| GET | `/api/stats` | Get dashboard statistics |
| GET / POST | `/api/animals` | Search or create animal records |
| GET / PUT / DELETE | `/api/animals/:id` | Read, update or delete an animal |
| PUT | `/api/animals/:id/claim` | Claim an unassigned case |
| PUT | `/api/animals/:id/assign` | Admin assigns or hands over a case |
| PUT | `/api/animals/:id/rescue` | Update rescue progress and placement |
| GET / POST | `/api/animals/:id/followups` | Read or add follow-ups |
| PUT / DELETE | `/api/animals/:id/followups/:followId` | Edit or delete a follow-up |
| GET / POST / PUT | `/api/animals/:id/adoption` | Read, register or edit an adoption |
| PUT | `/api/animals/:id/adoption-status` | Open or withdraw adoption availability |
| PUT | `/api/animals/:id/adoption/cancel` | Cancel an adoption |
| PUT | `/api/animals/:id/close` | Complete adoption and close the case |

The animal list supports `animalCode`, `animalType`, `foundLocation`, `rescueStatus`, `adoptionStatus`, `dateFrom`, `dateTo`, `sort` and `page`. Sort values are `updated_desc`, `updated_asc`, `created_desc` and `created_asc`. Dates use `YYYY-MM-DD` and include both endpoints in Hong Kong time.

For animal editing, claiming, assignment and rescue changes, send the latest animal `updatedAt` as `expectedUpdatedAt`. Follow-up editing/deletion uses that note's latest timestamp instead. Adoption editing, cancellation and closure use `adoptionId` and `adoptionVersion`. Animal deletion requires confirmation and a reason, but not a timestamp.

### 4.5 Short curl demonstration

These examples follow our presentation order: login, list, statistics, create, read, update, delete, verify deletion, and filtering. Run them in **Bash on Ubuntu/WSL**, with Node.js and curl 7.76 or later. Keep the local server running in another terminal.

Use the local demo administrator from 4.2. If using another authorized test environment, change the URL and username and enter that environment's own private password.

Run each block in order. Commands joined by `&&` stop that block if a command fails. If a request fails unexpectedly, stop and solve it before moving to the next block. The 404 in step 8 is expected.

Responses are saved in a new temporary folder for each run. HTTP status goes to stderr, so it does not get mixed into JSON parsing. List requests show only the first two results to keep the terminal readable.

#### 0. Prepare before the demo

```bash
BASE=http://127.0.0.1:8099 &&
DEMO_DIR=$(mktemp -d) &&
export DEMO_DIR &&
COOKIE="$DEMO_DIR/cookies.txt" &&
USER_NAME=demo_admin007 &&
set -o pipefail &&
curl -sS --fail-with-body -c "$COOKIE" "$BASE/api/csrf" -o "$DEMO_DIR/csrf.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf.json").data.csrfToken')
```

#### 1. Log in as administrator

```bash
read -r -s -p 'Admin password: ' PASS &&
printf '\n' &&
USER_NAME="$USER_NAME" PASS="$PASS" node -e 'process.stdout.write(JSON.stringify({username:process.env.USER_NAME,password:process.env.PASS}))' | \
  curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @- "$BASE/api/login" -w '%{stderr}\nLOGIN HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/login.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?{success:r.success,username:r.data.username,role:r.data.role}:r,null,2))' &&
unset PASS &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" "$BASE/api/csrf" -o "$DEMO_DIR/csrf.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf.json").data.csrfToken')
```

#### 2. GET the animal list

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals?page=1" -w '%{stderr}\nGET HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/list.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?{success:r.success,pagination:r.pagination,animals:r.data.slice(0,2).map(a=>({_id:a._id,animalCode:a.animalCode,animalType:a.animalType,foundLocation:a.foundLocation,healthStatus:a.healthStatus,rescueStatus:a.rescueStatus}))}:r,null,2))'
```

#### 3. GET dashboard statistics

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/stats" -w '%{stderr}\nGET HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/stats.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?{totalAnimals:r.data.total,rescueCounts:r.data.rescueCounts,adoptionCounts:r.data.adoptionCounts}:r,null,2))'
```

#### 4. POST a new test animal

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"animalType":"cat","appearance":"CURL DEMO ONLY - Orange Cat","foundLocation":"Demo Campus Gate","healthStatus":"Needs assessment","contactName":"Demo Staff","phoneCode":"+852","contactPhone":"61234567"}' \
  "$BASE/api/animals" -w '%{stderr}\nPOST HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/created.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))' &&
ID=$(node -p 'require(process.env.DEMO_DIR + "/created.json").data._id') &&
echo "Created animal ID: $ID"
```

#### 5. GET the new animal

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nGET HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/read.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))' &&
VER=$(node -p 'require(process.env.DEMO_DIR + "/read.json").data.updatedAt')
```

#### 6. PUT the updated health condition

```bash
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary "{\"animalType\":\"cat\",\"appearance\":\"CURL DEMO ONLY - Orange Cat\",\"foundLocation\":\"Demo Campus Gate\",\"healthStatus\":\"Healthy\",\"contactName\":\"Demo Staff\",\"phoneCode\":\"+852\",\"contactPhone\":\"61234567\",\"expectedUpdatedAt\":\"$VER\"}" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nPUT HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/updated.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))'
```

#### 7. DELETE this test animal

```bash
test "$(node -p 'require(process.env.DEMO_DIR + "/updated.json").data._id')" = "$ID" &&
test "$(node -p 'require(process.env.DEMO_DIR + "/updated.json").data.appearance')" = 'CURL DEMO ONLY - Orange Cat' &&
curl -sS --fail-with-body -X DELETE -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{"confirm":true,"deletionReason":"Remove disposable CURL demonstration record"}' \
  "$BASE/api/animals/$ID" -w '%{stderr}\nDELETE HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/deleted.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))'
```

#### 8. GET again to check deletion

```bash
curl -sS -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nGET HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/not-found.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))'
```

The response should be **404 Not Found** because the record has been deleted. This is an expected result.

#### 9. GET with filters sorting and pagination

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals?animalType=cat&sort=updated_desc&page=1" -w '%{stderr}\nGET HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/filtered.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?{success:r.success,pagination:r.pagination,animals:r.data.slice(0,2).map(a=>({_id:a._id,animalCode:a.animalCode,animalType:a.animalType,foundLocation:a.foundLocation,healthStatus:a.healthStatus,rescueStatus:a.rescueStatus}))}:r,null,2))'
```

Use `page=2` if there are enough matching records to show another page.

#### 10. Log out and remove the temporary files

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary '{}' \
  "$BASE/api/logout" -w '%{stderr}\nPOST HTTP %{http_code}\n' | \
  tee "$DEMO_DIR/logout.json" | \
  node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(r.success?r:r,null,2))' &&
rm -f -- "$DEMO_DIR/cookies.txt" "$DEMO_DIR"/*.json &&
rmdir -- "$DEMO_DIR"
```

Expected results: GET, PUT and DELETE normally return **200**; creating the animal returns **201**; the deletion check returns **404**. Check that the updated response shows `Healthy` before deleting the test record.

These short examples cover animal CRUD, statistics and filtering. Extra commands for accounts, rescue, follow-ups and adoption are in [the full API examples](docs/REST_API_FULL_CHECKS.md). Prepare those too when demonstrating all REST services required by the assignment.
