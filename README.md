# COMP3810SEF Group Project — Group 007

## 1. Project Information

**Project Name:** Animal Rescue and Adoption Management System（流浪动物救助与领养管理系统）

**Group:** 007

This project is a server-side web application developed using Express.js, Node.js, MongoDB, Mongoose, and EJS.

It supports the management of animal rescue records throughout the workflow from initial registration, rescue and placement, follow-up care, adoption registration, and case closure.

### Main Functionalities

- Staff login, logout, profile management, and password management.
- Animal registration, detailed record viewing, and basic information editing.
- Animal search with combined filters, registration date range, pagination, and sorting.
- Dashboard statistics based on MongoDB records.
- Rescue progress, staff assignment, and placement management.
- Follow-up record creation, viewing, editing, and deletion.
- Adoption availability, adoption registration, cancellation, and case closure.
- Administrator-controlled deletion and associated-record cleanup.
- RESTful APIs for CRUD operations.

## 2. Group Information

| Member | Name / SID | Responsibilities |
|---|---|---|
| T | To be completed | Authentication, login/logout, profile, password, and access control |
| L | To be completed | Animal creation, details, and basic information editing |
| Y | To be completed | Dashboard, searching, filtering, date range selection, pagination, and sorting |
| M | To be completed | Rescue management, staff assignment, placement, and follow-up CRUD |
| N | To be completed | Adoption, case closure, deletion, and related data consistency |

Each member contributes to the corresponding frontend, backend, database operations, testing, and integration.

## 3. Project File Introduction

### Project Structure

```text
comp3810sef_group007/
├── server.js
├── package.json
├── package-lock.json
├── models/
│   ├── User.js
│   ├── Animal.js
│   ├── FollowUp.js
│   ├── Adoption.js
│   ├── DeletionLog.js
│   └── constants.js
├── views/
│   ├── header.ejs
│   ├── footer.ejs
│   ├── dashboard.ejs
│   ├── list.ejs
│   ├── login.ejs
│   ├── profile.ejs
│   ├── password.ejs
│   ├── create.ejs
│   ├── details.ejs
│   ├── edit.ejs
│   ├── rescue.ejs
│   ├── followup.ejs
│   ├── adoption.ejs
│   ├── close.ejs
│   └── delete.ejs
├── public/
│   ├── style.css
│   ├── preview.js
│   ├── date_range.js
│   └── date_range.css
└── README.md
```

Other supporting EJS partials and module documentation may also be present.

### File Descriptions

- `server.js`: Express server configuration, session authentication, routes, validation, business logic, and database initialization.
- `package.json`: Project dependencies and npm scripts.
- `models/`: Mongoose schemas, relationships, validation rules, and database models.
- `views/`: EJS templates for the application pages.
- `public/style.css`: Shared user-interface styling.
- `public/preview.js`: Preview-related client-side behavior for applicable prototype elements.
- `public/date_range.js`: Date range calendar interaction for animal search.
- `public/date_range.css`: Date range calendar styling.

## 4. Database Design

**Database:** `animal_rescue_group007`

**Database Technology:** MongoDB with Mongoose.

The application uses the following main collections:

| Collection | Description |
|---|---|
| `users` | Staff and administrator accounts |
| `animals` | Animal records, rescue status, and adoption status |
| `followups` | Rescue follow-up records |
| `adoptions` | Adoption information and associated history |
| `deletionlogs` | Administrator deletion audit records |

MongoDB ObjectId values are used to identify and reference related records. Mongoose timestamps record creation and modification times.

Date values are stored in UTC and presented in the application using UTC+8 (Beijing time).

Passwords are stored as hashes rather than plaintext.

## 5. Installation and Running

### Requirements

- Ubuntu or another supported operating system
- Node.js 24
- npm
- MongoDB (local or MongoDB Atlas)

### Install Dependencies

```bash
npm ci
```

### Database Configuration

Set `MONGODB_URI` to the connection string of the chosen MongoDB database. The connection string must not be committed to GitHub.

A sample URI format is:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER_HOST/animal_rescue_group007
```

Replace the placeholders locally.

### Start the Application

```bash
CONNECT_DB=1 Y_PREVIEW=0 npm start
```

Open:

```text
http://127.0.0.1:8099
```

The database must be reachable before launching the application.

## 6. Login and Logout Guide

The system requires authenticated staff access to protected webpages.

For local development, a test staff account can be initialized using the explicitly provided test-user command in `server.js`.

**Test username:** `l_demo_staff`

The password is defined locally when creating the test user and is not included in this repository.

To log in, visit `/login`, enter the valid credentials, and submit the form.

To log out, use the application logout control.

Administrators have additional permissions, including deletion of animal records.

## 7. Web CRUD Operation Guide

### Create

1. Log in.
2. Open **新增动物**.
3. Complete the required animal information.
4. Submit the form.
5. Confirm the record appears in the animal list.

### Read

1. Open **动物档案**.
2. Filter by animal type, discovery location, rescue status, adoption status, or registration date range.
3. Use sorting and pagination to navigate the results.
4. Open an animal record to view details.

### Update

1. Open the animal detail page.
2. Edit basic information, rescue progress, placement, or follow-up records as permitted.
3. Submit and refresh the page to verify persistence.

### Delete

1. Log in using an authorized administrator account.
2. Open the corresponding animal deletion page.
3. Review the deletion details and provide any required confirmation.
4. Confirm that associated records are cleaned up according to the application rules.

## 8. Adoption Workflow

1. Register a rescued animal.
2. Assign a responsible staff member.
3. Complete rescue and placement.
4. Confirm the animal is suitable for adoption.
5. Open adoption availability.
6. Register the adopter and contact information.
7. Complete adoption and close the case.

Closed animal records remain available for historical reference unless explicitly deleted by an authorized administrator.

## 9. RESTful API Guide

The following endpoints are implemented as part of the application. Protected API operations require a valid login session; write operations also require CSRF validation.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/animals` | Search animal records |
| GET | `/api/stats` | Retrieve dashboard statistics |
| GET | `/api/animals/:id` | Read an animal record |
| POST | `/api/animals` | Create an animal record |
| PUT | `/api/animals/:id` | Update basic animal information |
| PUT | `/api/animals/:id/rescue` | Update rescue information |
| GET | `/api/animals/:id/followups` | Read follow-up records |
| POST | `/api/animals/:id/followups` | Create a follow-up record |
| PUT | `/api/animals/:id/followups/:followId` | Update a follow-up record |
| DELETE | `/api/animals/:id/followups/:followId` | Delete a follow-up record |
| GET | `/api/animals/:id/adoption` | Read adoption information |
| PUT | `/api/animals/:id/adoption-status` | Change adoption availability |
| POST | `/api/animals/:id/adoption` | Register an adoption |
| PUT | `/api/animals/:id/close` | Complete an adoption and close the case |
| DELETE | `/api/animals/:id` | Delete an animal record (administrator only) |

### API Test Example

A non-authenticated request to a protected API can be tested with:

```bash
curl -i http://127.0.0.1:8099/api/animals
```

Expected behavior: HTTP 401 when no valid login session is provided.

An authenticated request requires the login cookie. Write operations additionally require the CSRF token associated with that session.

Before final submission, document and verify the complete GET, POST, PUT, and DELETE `curl` examples using test credentials and test animal IDs.

## 10. Testing and Validation

The integration test plan includes:

- Successful and unsuccessful login.
- Session expiration and logout.
- Unauthorized access rejection.
- Animal CRUD and validation.
- Search, date range filtering, sorting, and pagination.
- Rescue progress and follow-up management.
- Author/administrator authorization for follow-up edits and deletions.
- Adoption status transitions and case closure.
- Duplicate-request rejection.
- Referential integrity and transaction behavior.
- MongoDB data persistence after page refresh.

Only tests actually executed and verified should be marked as passed in the final submission.

## 11. Submission Notes

The submission includes the source code, required package files, Mongoose models, EJS templates, public assets, and this README.

Do not include:

- `node_modules/`
- Database passwords or full connection strings
- Session secrets
- Personal access tokens
- Unnecessary test data exports

The final zip file should follow the course naming requirement:

```text
comp3810sef_group007.zip
```