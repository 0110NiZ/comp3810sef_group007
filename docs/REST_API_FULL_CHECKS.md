# Full REST API examples

These extra examples cover accounts, rescue, follow-ups and adoption as well as animal CRUD. Use the local demo database from the main README. They are separate from the short presentation sequence.


Use **Bash on Ubuntu/WSL** with curl 7.76+ and Node.js on PATH, against the isolated local demo described in the main README. Keep the server running in another terminal. The commands below are individual commands, not a helper script. Run each numbered block in order and inspect its responses before proceeding. Commands within each block are joined with `&&`, so a failed request prevents its dependent commands in that block from running. **Stop after any unexpected error; do not continue dependent ID/version operations.** The final 404 check is intentional.

`--fail-with-body` reports HTTP errors while retaining their JSON body. `-w` prints the request/status to stderr; `tee` displays and saves pure JSON for ID/version extraction. No response headers are mixed into parsed JSON. One temporary directory is created per run.

The full checklist covers all API method/path pairs above; it is longer than a three-minute basic CRUD demonstration. Prepare and rehearse the presentation separately to cover the services required by the assessment.

#### 1 Login and CSRF

Expected: Login returns 200 and role admin. Enter Arc-Admin-007-demo only for this isolated local demo.

```bash
BASE=http://127.0.0.1:8099 &&
DEMO_DIR=$(mktemp -d) &&
export DEMO_DIR &&
COOKIE="$DEMO_DIR/cookies.txt" &&
set -o pipefail &&
curl -sS --fail-with-body -c "$COOKIE" "$BASE/api/csrf" -o "$DEMO_DIR/csrf.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf.json").data.csrfToken') &&
LOGIN_USER=demo_admin007 &&
read -r -s -p 'Local demo admin password: ' LOGIN_PASSWORD &&
printf '\n' &&
export LOGIN_USER LOGIN_PASSWORD &&
node -e 'process.stdout.write(JSON.stringify({username:process.env.LOGIN_USER,password:process.env.LOGIN_PASSWORD}))' | \
  curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  --data-binary @- "$BASE/api/login" -w '%{stderr}\nPOST /api/login HTTP %{http_code}\n' | tee "$DEMO_DIR/login.json" &&
unset LOGIN_PASSWORD &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" "$BASE/api/csrf" -o "$DEMO_DIR/csrf.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf.json").data.csrfToken')
```

#### 2 Personal profile

Expected: 200; display name and phone change.

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/profile" -w '%{stderr}\nGET /api/profile HTTP %{http_code}\n' | tee "$DEMO_DIR/profile.json" &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"displayName":"Demo Administrator","phoneCode":"+852","phone":"12345678"}' \
  "$BASE/api/profile" -w '%{stderr}\nPUT /api/profile HTTP %{http_code}\n' | tee "$DEMO_DIR/profile-updated.json"
```

#### 3 Staff accounts and access

Expected: List 200, creation 201, then isActive false and true. A separate username is used so the webpage demo staff account is preserved.

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/users" -w '%{stderr}\nGET /api/users HTTP %{http_code}\n' | tee "$DEMO_DIR/users.json" &&
RUN_TAG=$(date +%s) &&
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"username\":\"api_staff_$RUN_TAG\",\"displayName\":\"API Demo Staff\",\"password\":\"Arc-Staff-007-demo\"}" \
  "$BASE/api/users" -w '%{stderr}\nPOST /api/users HTTP %{http_code}\n' | tee "$DEMO_DIR/staff.json" &&
STAFF_ID=$(node -p 'require(process.env.DEMO_DIR + "/staff.json").data._id') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"isActive":false}' \
  "$BASE/api/users/$STAFF_ID/status" -w '%{stderr}\nPUT /api/users/$STAFF_ID/status HTTP %{http_code}\n' | tee "$DEMO_DIR/staff-disabled.json" &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"isActive":true}' \
  "$BASE/api/users/$STAFF_ID/status" -w '%{stderr}\nPUT /api/users/$STAFF_ID/status HTTP %{http_code}\n' | tee "$DEMO_DIR/staff-enabled.json"
```

#### 4 Animal create read and update

Expected: POST 201; GET/PUT 200; healthStatus becomes Healthy.

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"animalType":"cat","appearance":"README API workflow cat","foundLocation":"Demo Campus Gate","healthStatus":"Needs assessment","contactName":"Demo Contact","phoneCode":"+852","contactPhone":"61234567"}' \
  "$BASE/api/animals" -w '%{stderr}\nPOST /api/animals HTTP %{http_code}\n' | tee "$DEMO_DIR/animal.json" &&
ID=$(node -p 'require(process.env.DEMO_DIR + "/animal.json").data._id') &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nGET /api/animals/$ID HTTP %{http_code}\n' | tee "$DEMO_DIR/animal-read.json" &&
VER=$(node -p 'require(process.env.DEMO_DIR + "/animal-read.json").data.updatedAt') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"animalType\":\"cat\",\"appearance\":\"README API workflow cat\",\"foundLocation\":\"Demo Campus Gate\",\"healthStatus\":\"Healthy\",\"contactName\":\"Demo Contact\",\"phoneCode\":\"+852\",\"contactPhone\":\"61234567\",\"expectedUpdatedAt\":\"$VER\"}" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nPUT /api/animals/$ID HTTP %{http_code}\n' | tee "$DEMO_DIR/animal-updated.json" &&
VER=$(node -p 'require(process.env.DEMO_DIR + "/animal-updated.json").data.updatedAt')
```

#### 5 Claim handover and placement

Expected: 200. Claim assigns the current admin; assignment then hands the case to the new staff user. The admin remains authorized to manage it.

```bash
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"expectedUpdatedAt\":\"$VER\"}" \
  "$BASE/api/animals/$ID/claim" -w '%{stderr}\nPUT /api/animals/$ID/claim HTTP %{http_code}\n' | tee "$DEMO_DIR/claimed.json" &&
VER=$(node -p 'require(process.env.DEMO_DIR + "/claimed.json").data.updatedAt') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"assignedTo\":\"$STAFF_ID\",\"expectedUpdatedAt\":\"$VER\"}" \
  "$BASE/api/animals/$ID/assign" -w '%{stderr}\nPUT /api/animals/$ID/assign HTTP %{http_code}\n' | tee "$DEMO_DIR/assigned.json" &&
VER=$(node -p 'require(process.env.DEMO_DIR + "/assigned.json").data.updatedAt') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"rescueStatus\":\"placed\",\"placementLocation\":\"East Shelter\",\"expectedUpdatedAt\":\"$VER\"}" \
  "$BASE/api/animals/$ID/rescue" -w '%{stderr}\nPUT /api/animals/$ID/rescue HTTP %{http_code}\n' | tee "$DEMO_DIR/placed.json"
```

#### 6 Follow-up create read edit and delete

Expected: Creation 201; reads/edits/deletion 200. The second new note is retained as case history.

```bash
TODAY=$(TZ=Asia/Hong_Kong date +%F) &&
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"content\":\"Ate well\",\"nextFollowUpDate\":\"$TODAY\"}" \
  "$BASE/api/animals/$ID/followups" -w '%{stderr}\nPOST /api/animals/$ID/followups HTTP %{http_code}\n' | tee "$DEMO_DIR/note.json" &&
FOLLOW_ID=$(node -p 'require(process.env.DEMO_DIR + "/note.json").data._id') &&
FVER=$(node -p 'require(process.env.DEMO_DIR + "/note.json").data.updatedAt') &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID/followups" -w '%{stderr}\nGET /api/animals/$ID/followups HTTP %{http_code}\n' | tee "$DEMO_DIR/notes.json" &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"content\":\"Ate well and responded calmly\",\"expectedUpdatedAt\":\"$FVER\"}" \
  "$BASE/api/animals/$ID/followups/$FOLLOW_ID" -w '%{stderr}\nPUT /api/animals/$ID/followups/$FOLLOW_ID HTTP %{http_code}\n' | tee "$DEMO_DIR/note-updated.json" &&
FVER=$(node -p 'require(process.env.DEMO_DIR + "/note-updated.json").data.updatedAt') &&
curl -sS --fail-with-body -X DELETE -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"expectedUpdatedAt\":\"$FVER\"}" \
  "$BASE/api/animals/$ID/followups/$FOLLOW_ID" -w '%{stderr}\nDELETE /api/animals/$ID/followups/$FOLLOW_ID HTTP %{http_code}\n' | tee "$DEMO_DIR/note-deleted.json" &&
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"content\":\"Care checked before adoption\",\"nextFollowUpDate\":\"$TODAY\"}" \
  "$BASE/api/animals/$ID/followups" -w '%{stderr}\nPOST /api/animals/$ID/followups HTTP %{http_code}\n' | tee "$DEMO_DIR/note-retained.json"
```

#### 7 Dashboard filters sorting and pagination

Expected: 200; filtered response includes pagination information.

```bash
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/stats" -w '%{stderr}\nGET /api/stats HTTP %{http_code}\n' | tee "$DEMO_DIR/stats.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals?animalType=cat&foundLocation=Demo%20Campus%20Gate&sort=updated_desc&page=1" -w '%{stderr}\nGET /api/animals?animalType=cat&foundLocation=Demo%20Campus%20Gate&sort=updated_desc&page=1 HTTP %{http_code}\n' | tee "$DEMO_DIR/filtered.json"
```

#### 8 Open and withdraw adoption availability

Expected: 200; available, not_open, then available again.

```bash
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"adoptionStatus":"available","healthConfirmed":true}' \
  "$BASE/api/animals/$ID/adoption-status" -w '%{stderr}\nPUT /api/animals/$ID/adoption-status HTTP %{http_code}\n' | tee "$DEMO_DIR/available.json" &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"adoptionStatus":"not_open"}' \
  "$BASE/api/animals/$ID/adoption-status" -w '%{stderr}\nPUT /api/animals/$ID/adoption-status HTTP %{http_code}\n' | tee "$DEMO_DIR/withdrawn.json" &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"adoptionStatus":"available","healthConfirmed":true}' \
  "$BASE/api/animals/$ID/adoption-status" -w '%{stderr}\nPUT /api/animals/$ID/adoption-status HTTP %{http_code}\n' | tee "$DEMO_DIR/available-again.json"
```

#### 9 Register read edit and cancel an adoption

Expected: Registration 201; read/edit/cancel 200. Cancellation history is retained and the animal returns to available.

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"adopterName":"Demo Adopter","phoneCode":"+852","adopterPhone":"23456789","remarks":"Home checked"}' \
  "$BASE/api/animals/$ID/adoption" -w '%{stderr}\nPOST /api/animals/$ID/adoption HTTP %{http_code}\n' | tee "$DEMO_DIR/adoption-created.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID/adoption" -w '%{stderr}\nGET /api/animals/$ID/adoption HTTP %{http_code}\n' | tee "$DEMO_DIR/adoption-read.json" &&
ADOPTION_ID=$(node -p 'require(process.env.DEMO_DIR + "/adoption-read.json").data.adoption._id') &&
AVERSION=$(node -p 'require(process.env.DEMO_DIR + "/adoption-read.json").data.adoption.__v || 0') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"adopterName\":\"Demo Adopter\",\"phoneCode\":\"+852\",\"adopterPhone\":\"23456789\",\"remarks\":\"Handover arranged\",\"adoptionId\":\"$ADOPTION_ID\",\"adoptionVersion\":$AVERSION}" \
  "$BASE/api/animals/$ID/adoption" -w '%{stderr}\nPUT /api/animals/$ID/adoption HTTP %{http_code}\n' | tee "$DEMO_DIR/adoption-updated.json" &&
AVERSION=$(node -p 'require(process.env.DEMO_DIR + "/adoption-updated.json").data.adoption.__v || 0') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"adoptionId\":\"$ADOPTION_ID\",\"adoptionVersion\":$AVERSION,\"confirm\":true,\"cancellationReason\":\"Demo applicant withdrew\"}" \
  "$BASE/api/animals/$ID/adoption/cancel" -w '%{stderr}\nPUT /api/animals/$ID/adoption/cancel HTTP %{http_code}\n' | tee "$DEMO_DIR/adoption-cancelled.json"
```

#### 10 Register again and complete handover

Expected: Registration 201; closure/read 200. The animal is adopted, closedAt is set, and the record is read-only.

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"adopterName":"Second Demo Adopter","phoneCode":"+852","adopterPhone":"23456789","remarks":"Home checked"}' \
  "$BASE/api/animals/$ID/adoption" -w '%{stderr}\nPOST /api/animals/$ID/adoption HTTP %{http_code}\n' | tee "$DEMO_DIR/new-adoption.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID/adoption" -w '%{stderr}\nGET /api/animals/$ID/adoption HTTP %{http_code}\n' | tee "$DEMO_DIR/current-adoption.json" &&
ADOPTION_ID=$(node -p 'require(process.env.DEMO_DIR + "/current-adoption.json").data.adoption._id') &&
AVERSION=$(node -p 'require(process.env.DEMO_DIR + "/current-adoption.json").data.adoption.__v || 0') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary "{\"adoptionId\":\"$ADOPTION_ID\",\"adoptionVersion\":$AVERSION,\"confirm\":true}" \
  "$BASE/api/animals/$ID/close" -w '%{stderr}\nPUT /api/animals/$ID/close HTTP %{http_code}\n' | tee "$DEMO_DIR/closed.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$ID" -w '%{stderr}\nGET /api/animals/$ID HTTP %{http_code}\n' | tee "$DEMO_DIR/closed-animal.json"
```

#### 11 Delete a separate open animal and verify 404

Expected: POST 201, DELETE 200, then intentionally GET 404. The completed adoption case is not deleted.

```bash
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"animalType":"cat","appearance":"README deletion test","foundLocation":"Demo Campus Gate","healthStatus":"Needs assessment","contactName":"Demo Contact","phoneCode":"+852","contactPhone":"61234567"}' \
  "$BASE/api/animals" -w '%{stderr}\nPOST /api/animals HTTP %{http_code}\n' | tee "$DEMO_DIR/delete-animal.json" &&
DELETE_ID=$(node -p 'require(process.env.DEMO_DIR + "/delete-animal.json").data._id') &&
curl -sS --fail-with-body -X DELETE -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"confirm":true,"deletionReason":"Remove separate disposable README test record"}' \
  "$BASE/api/animals/$DELETE_ID" -w '%{stderr}\nDELETE /api/animals/$DELETE_ID HTTP %{http_code}\n' | tee "$DEMO_DIR/animal-deleted.json" &&
curl -sS -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/animals/$DELETE_ID" -w '%{stderr}\nGET /api/animals/$DELETE_ID HTTP %{http_code}\n'
```

#### 12 Change and restore the local demo password

Expected: 200 for each request. Run after the webpage demo: changing a password signs out other sessions. The second change restores the documented local demo password; refresh CSRF after both changes.

```bash
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"currentPassword":"Arc-Admin-007-demo","newPassword":"Arc-Admin-007-updated","confirmPassword":"Arc-Admin-007-updated"}' \
  "$BASE/api/password" -w '%{stderr}\nPUT /api/password HTTP %{http_code}\n' | tee "$DEMO_DIR/password-changed.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/csrf" -w '%{stderr}\nGET /api/csrf HTTP %{http_code}\n' | tee "$DEMO_DIR/csrf-new.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf-new.json").data.csrfToken') &&
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"currentPassword":"Arc-Admin-007-updated","newPassword":"Arc-Admin-007-demo","confirmPassword":"Arc-Admin-007-demo"}' \
  "$BASE/api/password" -w '%{stderr}\nPUT /api/password HTTP %{http_code}\n' | tee "$DEMO_DIR/password-restored.json" &&
curl -sS --fail-with-body -b "$COOKIE" -c "$COOKIE" \
  "$BASE/api/csrf" -w '%{stderr}\nGET /api/csrf HTTP %{http_code}\n' | tee "$DEMO_DIR/csrf-restored.json" &&
TOKEN=$(node -p 'require(process.env.DEMO_DIR + "/csrf-restored.json").data.csrfToken')
```

#### 13 Disable the disposable API staff account and sign out

Expected: 200; API staff is disabled and the curl session is signed out. Cookie files remain private in the temporary directory; remove that directory after review.

```bash
curl -sS --fail-with-body -X PUT -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  --data-binary '{"isActive":false}' \
  "$BASE/api/users/$STAFF_ID/status" -w '%{stderr}\nPUT /api/users/$STAFF_ID/status HTTP %{http_code}\n' | tee "$DEMO_DIR/api-staff-cleanup.json" &&
curl -sS --fail-with-body -X POST -b "$COOKIE" -c "$COOKIE" \
  -H "X-CSRF-Token: $TOKEN" -H "Content-Type: application/json" \
  "$BASE/api/logout" -w '%{stderr}\nPOST /api/logout HTTP %{http_code}\n' | tee "$DEMO_DIR/logout.json" &&
printf 'Saved response files: %s\n' "$DEMO_DIR"
```
