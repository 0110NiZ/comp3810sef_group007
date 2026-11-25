// ============================================================================

// ============================================================================
// 00 Shared configuration and authentication context
const express = require('express');
const mongoose = require('mongoose');
const { applicationDatabaseName } = require('./services/database-config');
const path = require('node:path');
const { randomBytes, scrypt, timingSafeEqual, createHmac } = require('node:crypto');
const { promisify } = require('node:util');
const cookieSession = require('cookie-session');
const labels = require('./models/constants');
const { digitsByCode, phoneHint, phoneParts, normalizePhone } = require('./services/phone');
const Animal = require('./models/Animal');
const { animalCodePattern, nextAnimalCode, migrateAnimalCodes } = require('./services/animal-codes');
const FollowUp = require('./models/FollowUp');
const User = require('./models/User');
const app = express();
const scryptAsync = promisify(scrypt);
const RECORDS_PER_PAGE = 10;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
    express.urlencoded({
        extended: false,
        limit: '100kb',
        parameterLimit: 100
    })
);
app.use(
    express.json({
        limit: '100kb'
    })
);

const production = process.env.NODE_ENV === 'production';
const sessionKeys = (process.env.SESSION_KEYS || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
if (sessionKeys.some((key) => key.length < 32))
    throw new Error('SESSION_KEYS requires signing keys of at least 32 characters');
if (!sessionKeys.length) {
    if (production) throw new Error('Production requires SESSION_KEYS');

    sessionKeys.push(randomBytes(32).toString('hex'));
}

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(
    cookieSession({
        name: 'group007_session',
        keys: sessionKeys,
        maxAge: 8 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: production
    })
);
app.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.user = null;
    res.locals.currentUser = null;
    const userId = req.session?.userId;
    if (userId == null) return next();
    if (
        !Number.isSafeInteger(req.session.expiresAt) ||
        req.session.expiresAt <= Date.now()
    ) {
        req.session = null;
        return next();
    }
    if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) {
        req.session = null;
        return next();
    }
    try {
        const user = await User.findById(userId)
            .select('_id username displayName role isActive +passwordHash')
            .lean();
        const marker = req.session?.credentialMarker;
        if (
            !user ||
            user.isActive === false ||
            typeof user.passwordHash !== 'string' ||
            typeof marker !== 'string' ||
            !/^[a-f0-9]{64}$/.test(marker) ||
            !timingSafeEqual(
                Buffer.from(marker, 'hex'),
                Buffer.from(sessionCredentialMarker(user.passwordHash), 'hex')
            )
        ) {
            req.session = null;
            return next();
        }
        req.user = {
            _id: user._id,
            username: user.username,
            displayName: user.displayName,
            role: user.role
        };
        res.locals.currentUser = req.user;
        return next();
    } catch (error) {
        return next(error);
    }
});

app.use((req, res, next) => {
    if (!req.session?.csrfToken) {
        req.session = {
            ...(req.session || {}),
            csrfToken: randomBytes(32).toString('hex')
        };
    }
    res.locals.submittedPhoneCode = req.body?.phoneCode;
    res.locals.csrfToken = req.session.csrfToken;
    next();
});

function isApiRequest(req) {
    return req.path === '/api' || req.path.startsWith('/api/');
}

function sendApiError(res, status, code, message) {
    return res.status(status).json({
        success: false,
        error: {
            code,
            message
        }
    });
}

app.locals.phoneParts = phoneParts;
app.locals.digitsByCode = digitsByCode;
app.locals.labels = labels;
app.locals.managesCase = managesCase;

function managesCase(user, animal) {
    const coordinator = animal.assignedTo?._id || animal.assignedTo;
    return Boolean(user && (user.role === 'admin' ||
        (coordinator && String(coordinator) === String(user._id))));
}

function requireCaseManager(user, animal) {
    if (!managesCase(user, animal))
        nFail(403, 'FORBIDDEN', 'Only the rescue coordinator or an administrator can update this case.');
}

// Remember each work area's last filter without accepting arbitrary return URLs.
app.use((req, res, next) => {
    const category = /\/followups(?:\/|$)/.test(req.path)
        ? 'followups'
        : /\/(adoption|close)(?:\/|$)/.test(req.path)
          ? 'adoption'
          : /\/rescue$/.test(req.path)
            ? 'rescue'
            : '';
    const defaults = {
        rescue: '/rescue-management',
        followups: '/followup-records',
        adoption: '/adoption-management'
    };
    const back = animalRecordSource(req.query.returnTo);
    res.locals.backSource = back;
    res.locals.carryReturn = back ? '?returnTo=' + encodeURIComponent(back.url) : '';
    res.locals.returnQuery = (anchor = '') =>
        '?returnTo=' + encodeURIComponent(req.originalUrl + (anchor ? '#' + anchor : ''));
    res.locals.workAreaKey = category;
    res.locals.workReturn = category
        ? req.session?.workReturns?.[category] || defaults[category]
        : '';
    next();
});

function animalRecordSource(value) {
    const destinations = new Map([
        ['/animals', 'List'],
        ['/rescue-management', 'Rescue Management'],
        ['/followup-records', 'Follow-up Records'],
        ['/adoption-management', 'Adoption Management'],
        ['/', 'Overview']
    ]);
    if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('/'))
        return null;
    const url = URL.parse(value, 'http://localhost');
    if (!url || url.origin !== 'http://localhost') return null;
    const record = /^\/animals\/[a-f0-9]{24}(?:\/(adoption|rescue|close))?$/.exec(
        url.pathname
    );
    const label =
        destinations.get(url.pathname) ||
        (record &&
            ({
                adoption: 'Adoption Management',
                rescue: 'Rescue Management',
                close: 'Closure'
            }[record[1]] ||
                'Details'));
    return label ? { url: url.pathname + url.search + url.hash, label } : null;
}

app.locals.formatDate = (value) =>
    value
        ? new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Asia/Hong_Kong',
              dateStyle: 'medium',
              timeStyle: 'short'
          }).format(new Date(value))
        : '—';

// ============================================================================

// ============================================================================

// 01 T — Authentication, profiles and account administration
function requireLogin(req, res, next) {
    if (req.user) return next();
    if (isApiRequest(req)) return sendApiError(res, 401, 'UNAUTHORIZED', 'Please sign in.');
    return res.redirect(303, '/login');
}

function requireAdmin(req, res, next) {
    if (!req.user) return requireLogin(req, res, next);
    if (req.user.role === 'admin') return next();
    if (isApiRequest(req))
        return sendApiError(res, 403, 'FORBIDDEN', 'Administrator access required.');
    return res.status(403).render('info', {
        title: 'Access Denied',
        activePage: '',
        message: 'Only administrators can perform this action.'
    });
}

function sessionCredentialMarker(passwordHash) {
    return createHmac('sha256', sessionKeys[0]).update(passwordHash).digest('hex');
}

async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new Error('Password must contain 8–128 characters.');
    }
    const salt = randomBytes(16).toString('hex');
    const key = await scryptAsync(password, salt, 64);
    return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(storedHash)) return false;
    const [, salt, hash] = storedHash.split('$');
    const saved = Buffer.from(hash, 'hex');
    const derived = await scryptAsync(password, salt, saved.length);
    return timingSafeEqual(saved, derived);
}

function requireCsrf(req, res, next) {
    const supplied = req.get('x-csrf-token') || req.body?._csrf;
    const expected = req.session?.csrfToken;
    if (
        typeof supplied === 'string' &&
        typeof expected === 'string' &&
        /^[a-f0-9]{64}$/.test(supplied) &&
        /^[a-f0-9]{64}$/.test(expected) &&
        timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
    ) {
        return next();
    }
    if (isApiRequest(req)) {
        return sendApiError(
            res,
            403,
            'INVALID_CSRF',
            'Security validation failed. Reload and try again.'
        );
    }
    if (req.user) {
        return res.status(403).render('info', {
            title: 'Security Validation Failed',
            activePage: 'profile',
            message: 'Reload the page and submit again.'
        });
    }
    return res.status(403).render('login', {
        title: 'Staff Sign In',
        activePage: '',
        username: '',
        error: 'Security validation failed. Reload the sign-in page.'
    });
}

function loginError(req, res, status, code, message, username = '') {
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return res.status(status).render('login', {
        title: 'Staff Sign In',
        activePage: '',
        username,
        error: message
    });
}

async function loginHandler(req, res, next) {
    const rawUsername = req.body?.username;
    const password = req.body?.password;
    const username = typeof rawUsername === 'string' ? rawUsername.trim() : '';
    if (
        typeof rawUsername !== 'string' ||
        username.length < 3 ||
        username.length > 40 ||
        typeof password !== 'string' ||
        password.length < 8 ||
        password.length > 128
    ) {
        return loginError(
            req,
            res,
            400,
            'VALIDATION_ERROR',
            'Enter a valid username and password.',
            username
        );
    }
    if (mongoose.connection.readyState !== 1) {
        return loginError(
            req,
            res,
            503,
            'DATABASE_UNAVAILABLE',
            'Database unavailable. Start with CONNECT_DB=1 enabled',
            username
        );
    }
    try {
        const user = await User.findOne({
            username
        })
            .select('+passwordHash')
            .lean();
        if (
            !user ||
            user.isActive === false ||
            !(await verifyPassword(password, user.passwordHash))
        ) {
            return loginError(
                req,
                res,
                401,
                'INVALID_CREDENTIALS',
                'Incorrect username or password, or account disabled.',
                username
            );
        }
        req.session = {
            userId: String(user._id),
            expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            csrfToken: randomBytes(32).toString('hex'),
            credentialMarker: sessionCredentialMarker(user.passwordHash)
        };
        if (isApiRequest(req)) {
            return res.json({
                success: true,
                data: {
                    _id: user._id,
                    username: user.username,
                    displayName: user.displayName,
                    role: user.role
                },
                message: 'Signed in.'
            });
        }
        return res.redirect(303, '/');
    } catch (error) {
        return next(error);
    }
}

function logoutHandler(req, res) {
    req.session = null;
    if (isApiRequest(req)) {
        return res.json({
            success: true,
            data: {},
            message: 'Signed out.'
        });
    }
    return res.redirect(303, '/login');
}

app.get('/login', (req, res) => {
    if (req.user) return res.redirect(303, '/');
    return res.render('login', {
        title: 'Staff Sign In',
        activePage: '',
        username: '',
        error: ''
    });
});
app.post('/login', requireCsrf, loginHandler);
app.post('/logout', requireCsrf, logoutHandler);

app.get('/api/csrf', (req, res) =>
    res.json({
        success: true,
        data: {
            csrfToken: req.session.csrfToken
        },
        message: 'Security token created.'
    })
);
app.post('/api/login', requireCsrf, loginHandler);
app.post('/api/logout', requireCsrf, logoutHandler);

async function loadProfile(req) {
    return User.findById(req.user._id).select('_id username displayName phone role').lean();
}

function profileView(res, profile, options = {}) {
    return res.status(options.status || 200).render('profile', {
        title: 'My Account',
        activePage: 'profile',
        profile,
        editing: Boolean(options.editing || options.error),
        error: options.error || '',
        success: options.success || '',
        assignedAnimals: options.assignedAnimals || [],
        recentNotes: options.recentNotes || [],
        assignedCount: options.assignedCount || 0,
        unassignedCount: options.unassignedCount || 0
    });
}

app.get('/profile', requireLogin, async (req, res, next) => {
    try {
        const profile = await loadProfile(req);
        if (!profile)
            return res.status(404).render('info', {
                title: 'Account Not Found',
                activePage: '',
                message: 'Account not found. Please sign in again.'
            });
        if (req.query.edit === '1')
            return profileView(res, profile, { editing: true });

        const openCases = { closedAt: null, adoptionStatus: { $ne: 'adopted' } };
        const assignedCases = { ...openCases, assignedTo: req.user._id };
        const [assignedAnimals, assignedCount, recentNotes, unassignedCount] = await Promise.all([
            Animal.find(assignedCases).select('animalCode animalType appearance rescueStatus')
                .sort({ updatedAt: -1, animalCode: 1 }).limit(3).lean(),
            Animal.countDocuments(assignedCases),
            FollowUp.find({ recordedBy: req.user._id }).select('animalId content createdAt')
                .sort({ createdAt: -1, _id: -1 }).limit(2)
                .populate('animalId', 'animalCode').lean(),
            req.user.role === 'admin'
                ? Animal.countDocuments({ ...openCases, assignedTo: null }) : 0
        ]);
        const latestDates = assignedAnimals.length ? await FollowUp.aggregate([
            { $match: { animalId: { $in: assignedAnimals.map(animal => animal._id) } } },
            { $sort: { animalId: 1, createdAt: -1, _id: -1 } },
            { $group: { _id: '$animalId', due: { $first: '$nextFollowUpDate' } } }
        ]) : [];
        const dateByAnimal = new Map(latestDates.map(note => [String(note._id), note.due]));
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(new Date());
        for (const animal of assignedAnimals) {
            const due = dateByAnimal.get(String(animal._id));
            animal.followUpState = !due ? 'none' : due < today ? 'overdue' : due === today ? 'today' : 'future';
            animal.followUpLabel = !due ? 'No date set' : due < today ? 'Overdue' : due === today ? 'Today'
                : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
                    .format(new Date(due + 'T00:00:00Z'));
            animal.nextFollowUpDate = due || null;
        }
        return profileView(res, profile, {
            success: req.query.updated === 'password'
                ? 'Password updated. Other sessions have been signed out.'
                : req.query.updated === '1' ? 'Profile saved.' : '',
            assignedAnimals, assignedCount, recentNotes, unassignedCount
        });
    } catch (error) {
        return next(error);
    }
});

async function updateProfile(req, res, next) {
    try {
        const current = await loadProfile(req);
        if (!current) {
            if (isApiRequest(req))
                return sendApiError(res, 404, 'NOT_FOUND', 'Account Not Found');
            return res.status(404).render('info', {
                title: 'Account Not Found',
                activePage: '',
                message: 'Account not found. Please sign in again.'
            });
        }
        const allowed = isApiRequest(req)
            ? new Set(['displayName', 'phone', 'phoneCode'])
            : new Set(['displayName', 'phone', 'phoneCode', '_csrf']);
        const body = req.body || {};
        const rawName = body.displayName;
        const rawPhone = body.phone === undefined ? '' : body.phone;
        const displayName = typeof rawName === 'string' ? rawName.trim() : '';
        const phone = normalizePhone(rawPhone, body.phoneCode);
        const invalidPhone = phone === null;
        const invalid =
            Object.keys(body).some((key) => !allowed.has(key)) ||
            typeof rawName !== 'string' ||
            displayName.length < 1 ||
            displayName.length > 80 ||
            invalidPhone;
        if (invalid) {
            const message = invalidPhone ? phoneHint :
                'Display name must be 1–80 characters. Username and role cannot be changed.';
            if (isApiRequest(req))
                return sendApiError(res, 400, 'VALIDATION_ERROR', message);
            return profileView(
                res,
                {
                    ...current,
                    displayName,
                    phone: typeof rawPhone === 'string' ? rawPhone : ''
                },
                {
                    status: 400,
                    error: message
                }
            );
        }
        const updated = await User.findByIdAndUpdate(
            req.user._id,
            {
                $set: {
                    displayName,
                    phone
                }
            },
            {
                returnDocument: 'after',
                runValidators: true
            }
        )
            .select('_id username displayName phone role')
            .lean();
        if (!updated) {
            if (isApiRequest(req))
                return sendApiError(res, 404, 'NOT_FOUND', 'Account Not Found');
            return res.redirect(303, '/login');
        }
        if (isApiRequest(req)) {
            return res.json({
                success: true,
                data: updated,
                message: 'Profile saved.'
            });
        }
        return res.redirect(303, '/profile?updated=1');
    } catch (error) {
        return next(error);
    }
}

app.post('/profile', requireLogin, requireCsrf, updateProfile);
app.get('/api/profile', requireLogin, async (req, res, next) => {
    try {
        const profile = await loadProfile(req);
        if (!profile) return sendApiError(res, 404, 'NOT_FOUND', 'Account Not Found');
        return res.json({
            success: true,
            data: profile,
            message: 'Records loaded.'
        });
    } catch (error) {
        return next(error);
    }
});
app.put('/api/profile', requireLogin, requireCsrf, updateProfile);

function passwordView(res, status = 200, error = '', success = '') {
    return res.status(status).render('password', {
        title: 'Change Password',
        activePage: 'profile',
        error,
        success
    });
}

app.get('/password', requireLogin, (req, res) =>
    passwordView(
        res,
        200,
        '',
        req.query.updated === '1'
            ? 'Password updated. Other sessions have been signed out.'
            : ''
    )
);

function passwordError(req, res, status, code, message) {
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return passwordView(res, status, message);
}

async function updatePassword(req, res, next) {
    const allowed = isApiRequest(req)
        ? new Set(['currentPassword', 'newPassword', 'confirmPassword'])
        : new Set(['currentPassword', 'newPassword', 'confirmPassword', '_csrf']);
    const body = req.body || {};
    const { currentPassword, newPassword, confirmPassword } = body;
    if (
        Object.keys(body).some((key) => !allowed.has(key)) ||
        typeof currentPassword !== 'string' ||
        typeof newPassword !== 'string' ||
        typeof confirmPassword !== 'string' ||
        currentPassword.length < 8 ||
        currentPassword.length > 128 ||
        newPassword.length < 8 ||
        newPassword.length > 128 ||
        confirmPassword !== newPassword
    ) {
        return passwordError(
            req,
            res,
            400,
            'VALIDATION_ERROR',
            'Check your current password, new password (8–128 characters) and confirmation.'
        );
    }
    if (currentPassword === newPassword) {
        return passwordError(
            req,
            res,
            400,
            'VALIDATION_ERROR',
            'Choose a different new password.'
        );
    }
    try {
        const user = await User.findById(req.user._id).select('+passwordHash').lean();
        if (!user) return passwordError(req, res, 404, 'NOT_FOUND', 'Account Not Found');
        if (!(await verifyPassword(currentPassword, user.passwordHash))) {
            return passwordError(
                req,
                res,
                401,
                'INVALID_CREDENTIALS',
                'Current password is incorrect.'
            );
        }
        const newHash = await hashPassword(newPassword);

        const updated = await User.findOneAndUpdate(
            {
                _id: req.user._id,
                passwordHash: user.passwordHash
            },
            {
                $set: {
                    passwordHash: newHash
                }
            },
            {
                returnDocument: 'after',
                runValidators: true
            }
        )
            .select('+passwordHash')
            .lean();
        if (!updated) {
            return passwordError(
                req,
                res,
                409,
                'CONFLICT',
                'Password changed. Please sign in again.'
            );
        }

        req.session = {
            userId: String(user._id),
            expiresAt: Date.now() + 8 * 60 * 60 * 1000,
            csrfToken: randomBytes(32).toString('hex'),
            credentialMarker: sessionCredentialMarker(updated.passwordHash)
        };
        if (isApiRequest(req)) {
            return res.json({
                success: true,
                data: {},
                message: 'Password updated. Other sessions are no longer valid.'
            });
        }
        return res.redirect(303, '/profile?updated=password');
    } catch (error) {
        return next(error);
    }
}

app.post('/password', requireLogin, requireCsrf, updatePassword);
app.put('/api/password', requireLogin, requireCsrf, updatePassword);

// T: internal account administration. Staff accounts are disabled, never deleted.
const accountFields = '_id username displayName phone role isActive createdAt updatedAt';

async function accountList(req, res) {
    const users = await User.find({})
        .select(accountFields)
        .sort({
            createdAt: -1
        })
        .lean();
    const summary = {
        total: users.length,
        active: users.filter((user) => user.isActive !== false).length,
        inactive: users.filter((user) => user.isActive === false).length,
        administrators: users.filter((user) => user.role === 'admin').length
    };
    if (isApiRequest(req))
        return res.json({
            success: true,
            data: users,
            summary
        });
    return res.render('users', {
        title: 'Team Accounts',
        activePage: 'users',
        users,
        summary,
        success: req.query.saved === '1' ? 'Account changes saved.' : '',
        error: ''
    });
}

async function createStaff(req, res) {
    let message = '';
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const rawPhone = body.phone === undefined ? '' : body.phone;
    const phone = normalizePhone(rawPhone, body.phoneCode);
    if (
        Object.keys(body).some(
            (key) =>
                !['username', 'displayName', 'phone', 'phoneCode', 'password', '_csrf'].includes(key)
        ) ||
        !/^[a-zA-Z0-9_-]{3,40}$/.test(username) ||
        !displayName ||
        displayName.length > 80 ||
        typeof body.password !== 'string' ||
        body.password.length < 8 ||
        body.password.length > 128
    ) {
        message =
            'Use a 3–40 character username, a display name, and an 8–128 character password.';
    } else if (phone === null) {
        message = phoneHint;
    }
    if (!message) {
        try {
            const user = await User.create({
                username,
                displayName,
                phone,
                passwordHash: await hashPassword(body.password),
                role: 'staff',
                isActive: true
            });
            if (isApiRequest(req))
                return res.status(201).json({
                    success: true,
                    data: {
                        _id: user._id,
                        username,
                        displayName,
                        role: 'staff',
                        isActive: true
                    }
                });
            return res.redirect(303, '/users?saved=1');
        } catch (error) {
            if (error.code !== 11000) throw error;
            message = 'That username is already in use.';
        }
    }
    if (isApiRequest(req)) return sendApiError(res, 400, 'VALIDATION_ERROR', message);
    return res.status(400).render('user-new', {
        title: 'Create Staff Account',
        activePage: 'users',
        error: message,
        values: {
            username,
            displayName,
            phone: typeof rawPhone === 'string' ? rawPhone : ''
        }
    });
}

async function setStaffStatus(req, res) {
    const body = req.body || {};
    const isActive = body.isActive === true || body.isActive === 'true';
    if (
        !/^[a-f0-9]{24}$/i.test(req.params.id) ||
        ![true, false, 'true', 'false'].includes(body.isActive) ||
        Object.keys(body).some((key) => !['isActive', '_csrf'].includes(key))
    ) {
        return sendApiError(
            res,
            400,
            'VALIDATION_ERROR',
            'Provide a valid account ID and isActive boolean.'
        );
    }
    const user = await User.findOneAndUpdate(
        {
            _id: req.params.id,
            role: 'staff'
        },
        {
            $set: {
                isActive
            }
        },
        {
            returnDocument: 'after',
            runValidators: true
        }
    )
        .select(accountFields)
        .lean();
    if (!user) {
        if (isApiRequest(req))
            return sendApiError(
                res,
                404,
                'NOT_FOUND',
                'Staff account not found. Administrator accounts cannot be disabled here.'
            );
        return res.status(404).render('info', {
            title: 'Account unavailable',
            activePage: 'users',
            message: 'Only staff accounts can be enabled or disabled here.',
            returnUrl: '/users'
        });
    }
    if (isApiRequest(req))
        return res.json({
            success: true,
            data: user
        });
    return res.redirect(303, '/users?saved=1');
}

app.get('/users', requireLogin, requireAdmin, accountList);
app.get('/api/users', requireLogin, requireAdmin, accountList);
app.get('/users/new', requireLogin, requireAdmin, (req, res) =>
    res.render('user-new', {
        title: 'Create Staff Account',
        activePage: 'users',
        error: '',
        values: {}
    })
);
app.post('/users/new', requireLogin, requireAdmin, requireCsrf, createStaff);
app.post('/api/users', requireLogin, requireAdmin, requireCsrf, createStaff);
app.post('/users/:id/status', requireLogin, requireAdmin, requireCsrf, setStaffStatus);
app.put('/api/users/:id/status', requireLogin, requireAdmin, requireCsrf, setStaffStatus);

async function createAdministrator() {
    const username = process.env.ADMIN_USERNAME || 'admin01';
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(username)) throw new Error('Invalid ADMIN_USERNAME.');
    const password = require('node:fs').readFileSync(0, 'utf8').trimEnd();
    const passwordHash = await hashPassword(password);
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    try {
        const dbName = applicationDatabaseName(process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI, { dbName });
        await User.init();
        if (
            await User.exists({
                username
            })
        )
            throw new Error('Account already exists; nothing was changed.');
        await User.create({
            username,
            passwordHash,
            displayName: 'Administrator',
            role: 'admin',
            isActive: true
        });
        console.log('Administrator created. Sign in with the password you supplied.');
    } finally {
        await mongoose.disconnect();
    }
}

// ============================================================================

// ============================================================================

// 02 L — Animal registration and basic details
const LAnimal = require('./models/Animal');
const LFollowUp = require('./models/FollowUp');
const LAdoption = require('./models/Adoption');
const lBasicFields = [
    'animalType',
    'appearance',
    'foundLocation',
    'healthStatus',
    'contactName',
    'contactPhone'
];

function lError(status, code, message) {
    return Object.assign(new Error(message), {
        lStatus: status,
        lCode: code
    });
}

function lDatabase(req, res, next) {
    if (mongoose.connection.readyState === 1) return next();
    const message = 'Database unavailable. Start with CONNECT_DB=1 enabled';
    if (isApiRequest(req)) return sendApiError(res, 503, 'DATABASE_UNAVAILABLE', message);
    return res.status(503).render('info', {
        title: 'Database unavailable',
        activePage: 'list',
        message
    });
}

function lId(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id)) {
        throw lError(400, 'INVALID_ID', 'Invalid animal ID.');
    }
}

function lInput(body, editing) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw lError(400, 'VALIDATION_ERROR', 'Provide the animal details.');
    }
    const allowed = new Set([
        ...lBasicFields,
        'phoneCode',
        '_csrf',
        ...(editing ? ['expectedUpdatedAt'] : [])
    ]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
        throw lError(400, 'VALIDATION_ERROR', 'contains fields that cannot be changed');
    }
    const limits = {
        animalType: 10,
        appearance: 1000,
        foundLocation: 200,
        healthStatus: 1000,
        contactName: 80,
        contactPhone: 30
    };
    const values = {};
    for (const key of lBasicFields) {
        if (typeof body[key] !== 'string')
            throw lError(400, 'VALIDATION_ERROR', `${key} must be text`);
        values[key] = body[key].trim();
        if (!values[key] || values[key].length > limits[key]) {
            throw lError(
                400,
                'VALIDATION_ERROR',
                `${key} required; maximum ${limits[key]} characters`
            );
        }
    }
    values.contactPhone = normalizePhone(body.contactPhone, body.phoneCode);
    if (!values.contactPhone) throw lError(400, 'VALIDATION_ERROR', phoneHint);
    if (!Object.hasOwn(labels.animalTypes, values.animalType)) {
        throw lError(400, 'VALIDATION_ERROR', 'Select a valid animal type.');
    }
    return values;
}

function lSafeValues(body) {
    return Object.fromEntries(
        lBasicFields.map((key) => [
            key,
            typeof body?.[key] === 'string' ? body[key].slice(0, 1001) : ''
        ])
    );
}

function lFailure(error, req, res, next, form) {
    let status = error.lStatus || error.nStatus;
    let code = error.lCode || error.nCode;
    let message = error.message;
    if (error.code === 11000) {
        status = 409;
        code = 'DUPLICATE_CODE';
        message = 'Code conflict. Please register again.';
    } else if (error.name === 'ValidationError') {
        status = 400;
        code = 'VALIDATION_ERROR';
        message = 'Animal details do not meet the field requirements.';
    }
    if (!status) return next(error);
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    if (form && status === 400)
        return res.status(status).render(form.view, {
            title: form.view === 'create' ? 'Add Animal' : 'Edit Animal',
            activePage: form.view === 'create' ? 'create' : 'list',
            animal: {
                ...(form.animal || {}),
                ...lSafeValues(req.body)
            },
            expectedUpdatedAt: req.body?.expectedUpdatedAt,
            error: message
        });
    return res.status(status).render('info', {
        title: 'Action Not Completed',
        activePage: 'list',
        message
    });
}
async function lLoad(id) {
    lId(id);
    const animal = await LAnimal.findById(id).lean();
    if (!animal) throw lError(404, 'NOT_FOUND', 'Animal record not found.');
    return animal;
}

function lOpen(animal) {
    if (animal.closedAt || animal.adoptionStatus === 'adopted') {
        throw lError(409, 'ANIMAL_CLOSED', 'This case is closed and cannot be edited.');
    }
}

app.get('/animals/new', requireLogin, lDatabase, (req, res) =>
    res.render('create', {
        title: 'Add Animal',
        activePage: 'create',
        animal: {},
        error: ''
    })
);

async function lCreate(req, res, next) {
    try {
        const values = lInput(req.body, false);

        const animal = await LAnimal.create({
            ...values,
            animalCode: await nextAnimalCode(),
            createdBy: req.user._id,
            updatedBy: req.user._id,
            rescueStatus: 'pending',
            assignedTo: null,
            placementLocation: '',
            adoptionStatus: 'not_open',
            closedAt: null,
            closedBy: null
        });
        if (isApiRequest(req))
            return res.status(201).json({
                success: true,
                data: animal,
                message: 'Registered.'
            });
        return res.redirect(303, '/animals/' + animal._id);
    } catch (error) {
        return lFailure(error, req, res, next, {
            view: 'create'
        });
    }
}
app.post('/animals/new', requireLogin, requireCsrf, lDatabase, lCreate);
app.post('/api/animals', requireLogin, requireCsrf, lDatabase, lCreate);

app.get('/animals/:id/edit', requireLogin, lDatabase, async (req, res, next) => {
    try {
        const animal = await lLoad(req.params.id);
        lOpen(animal);
        requireCaseManager(req.user, animal);
        return res.render('edit', {
            title: 'Edit Animal',
            activePage: 'list',
            animal,
            expectedUpdatedAt: animal.updatedAt.toISOString(),
            error: ''
        });
    } catch (error) {
        return lFailure(error, req, res, next);
    }
});
async function lUpdate(req, res, next) {
    let animal;
    try {
        animal = await lLoad(req.params.id);
        lOpen(animal);
        requireCaseManager(req.user, animal);
        const values = lInput(req.body, true);
        const supplied = req.body.expectedUpdatedAt;
        if (supplied === undefined) {
            throw lError(
                400,
                'VALIDATION_ERROR',
                'Missing record version. Reopen the edit page.'
            );
        }
        if (
            supplied !== undefined &&
            (typeof supplied !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(supplied) ||
                !Number.isFinite(Date.parse(supplied)))
        ) {
            throw lError(
                400,
                'VALIDATION_ERROR',
                'Invalid record version. Reopen the edit page.'
            );
        }
        if (supplied !== undefined && supplied !== animal.updatedAt.toISOString()) {
            throw lError(
                409,
                'STALE_RECORD',
                'This record has changed. Reload it before editing.'
            );
        }
        const updated = await LAnimal.findOneAndUpdate(
            {
                _id: animal._id,
                closedAt: null,
                adoptionStatus: {
                    $ne: 'adopted'
                },
                updatedAt: animal.updatedAt,
                ...(req.user.role === 'admin' ? {} : { assignedTo: req.user._id })
            },
            {
                $set: {
                    ...values,
                    updatedBy: req.user._id,
                    updatedAt: new Date(
                        Math.max(Date.now(), animal.updatedAt.getTime() + 1)
                    )
                },
                $inc: {
                    __v: 1
                }
            },
            {
                returnDocument: 'after',
                runValidators: true,
                timestamps: false
            }
        ).lean();
        if (!updated) {
            const current = await lLoad(req.params.id);
            lOpen(current);
            throw lError(
                409,
                'STALE_RECORD',
                'This record has changed. Reload it before editing.'
            );
        }
        if (isApiRequest(req))
            return res.json({
                success: true,
                data: updated,
                message: 'Saved.'
            });
        return res.redirect(303, res.locals.backSource?.url || '/animals/' + updated._id);
    } catch (error) {
        return lFailure(
            error,
            req,
            res,
            next,
            animal && {
                view: 'edit',
                animal
            }
        );
    }
}
app.post('/animals/:id/edit', requireLogin, requireCsrf, lDatabase, lUpdate);
app.put('/api/animals/:id', requireLogin, requireCsrf, lDatabase, lUpdate);

app.get('/api/animals/:id', requireLogin, lDatabase, async (req, res, next) => {
    try {
        return res.json({
            success: true,
            data: await lLoad(req.params.id),
            message: 'Record loaded.'
        });
    } catch (error) {
        return lFailure(error, req, res, next);
    }
});
app.get('/animals/:id', requireLogin, lDatabase, async (req, res, next) => {
    try {
        const originalAnimal = await lLoad(req.params.id);
        const [animal, followUps, adoptionRecords] = await Promise.all([
            LAnimal.findById(req.params.id)
                .populate('createdBy assignedTo closedBy updatedBy', 'displayName username')
                .lean(),
            LFollowUp.find({
                animalId: req.params.id
            })
                .sort({
                    createdAt: -1,
                    _id: -1
                })
                .populate('recordedBy updatedBy', 'displayName username')
                .lean(),
            LAdoption.find({
                animalId: req.params.id
            })
                .sort({
                    createdAt: -1,
                    _id: -1
                })
                .populate('registeredBy cancelledBy', 'displayName username')
                .lean()
        ]);
        if (!animal) throw lError(404, 'NOT_FOUND', 'This animal record has been deleted.');
        const notice = req.session.workNotice;
        const rescueNotice = notice?.path === req.path && notice.id === req.params.id
            ? notice.message
            : '';
        if (rescueNotice) delete req.session.workNotice;
        const userName = (user) =>
            !user
                ? 'Account unavailable'
                : (typeof user === 'object' && (user.displayName || user.username)) ||
                  'Account unavailable';
        return res.render('details', {
            source: res.locals.backSource || { url: '/animals', label: 'List' },
            title: 'Animal Details',
            activePage: 'list',
            rescueNotice,
            animal,
            followUps,
            adoption: adoptionRecords[0] || null,
            adoptionRecords,
            userName,
            unassigned: !originalAnimal.assignedTo
        });
    } catch (error) {
        return lFailure(error, req, res, next);
    }
});

// ============================================================================

// ============================================================================

// 03 Y — Overview, filtering and pagination
const YAnimal = require('./models/Animal');

const Y_SORT_OPTIONS = {
    updated_desc: {
        updatedAt: -1,
        animalCode: 1
    },
    updated_asc: {
        updatedAt: 1,
        animalCode: 1
    },
    created_desc: {
        createdAt: -1,
        animalCode: 1
    },
    created_asc: {
        createdAt: 1,
        animalCode: 1
    }
};

function yDatabaseAvailable(req, res, next) {
    if (mongoose.connection.readyState === 1) {
        return next();
    }

    if (isApiRequest(req)) {
        return sendApiError(res, 503, 'DB_UNAVAILABLE', 'Database unavailable');
    }

    return res.status(503).render('info', {
        title: 'Database unavailable',
        activePage: '',
        message: 'Database unavailable. Check the MongoDB configuration.'
    });
}

function yError(message) {
    const error = new Error(message);
    error.status = 400;
    return error;
}

function yReadQuery(query, key) {
    const value = query[key];

    if (value === undefined) {
        return '';
    }

    if (typeof value !== 'string') {
        throw yError(`${key} has an invalid format`);
    }

    return value.trim();
}

function yValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function yParseFilters(query) {
    const filters = {
        animalCode: yReadQuery(query, 'animalCode').toUpperCase(),
        animalType: yReadQuery(query, 'animalType'),
        foundLocation: yReadQuery(query, 'foundLocation'),
        rescueStatus: yReadQuery(query, 'rescueStatus'),
        adoptionStatus: yReadQuery(query, 'adoptionStatus'),
        dateFrom: yReadQuery(query, 'dateFrom'),
        dateTo: yReadQuery(query, 'dateTo'),
        sort: yReadQuery(query, 'sort') || 'updated_desc'
    };

    const enums = [
        ['animalType', labels.animalTypes],
        ['rescueStatus', labels.rescueStatuses],
        ['adoptionStatus', labels.adoptionStatuses]
    ];

    for (const [field, values] of enums) {
        if (filters[field] && !Object.hasOwn(values, filters[field])) {
            throw yError(`${field} is invalid`);
        }
    }

    if (filters.foundLocation.length > 200) {
        throw yError('Location must be at most 200 characters.');
    }

    if (!Object.hasOwn(Y_SORT_OPTIONS, filters.sort)) {
        throw yError('Invalid sort order.');
    }

    for (const field of ['dateFrom', 'dateTo']) {
        if (filters[field] && !yValidDate(filters[field])) {
            throw yError(`${field} Invalid date format.`);
        }
    }

    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
        throw yError('Start date cannot be after end date.');
    }

    const rawPage = yReadQuery(query, 'page');

    if (
        rawPage &&
        (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)))
    ) {
        throw yError('Page must be a positive integer.');
    }

    return {
        filters,
        requestedPage: rawPage ? Number(rawPage) : 1
    };
}

function yEscapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yBuildMongoFilter(filters) {
    const query = {};
    if (filters.animalCode) query.animalCode = filters.animalCode;

    for (const field of ['animalType', 'rescueStatus', 'adoptionStatus']) {
        if (filters[field]) {
            query[field] = filters[field];
        }
    }

    if (filters.foundLocation) {
        query.foundLocation = {
            $regex: yEscapeRegex(filters.foundLocation),
            $options: 'i'
        };
    }

    if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};

        if (filters.dateFrom) {
            query.createdAt.$gte = new Date(`${filters.dateFrom}T00:00:00+08:00`);
        }

        if (filters.dateTo) {
            const nextDay = new Date(`${filters.dateTo}T00:00:00+08:00`);

            nextDay.setUTCDate(nextDay.getUTCDate() + 1);

            query.createdAt.$lt = nextDay;
        }
    }

    return query;
}

function yMatchMock(animal, filters) {
    for (const field of ['animalType', 'rescueStatus', 'adoptionStatus']) {
        if (filters[field] && animal[field] !== filters[field]) {
            return false;
        }
    }

    const location = String(animal.foundLocation || '');

    if (
        filters.foundLocation &&
        !location.toLowerCase().includes(filters.foundLocation.toLowerCase())
    ) {
        return false;
    }

    if (filters.dateFrom || filters.dateTo) {
        const createdAt = new Date(animal.createdAt);

        if (!Number.isFinite(createdAt.getTime())) {
            return false;
        }

        const date = new Date(createdAt.getTime() + 8 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);

        if (filters.dateFrom && date < filters.dateFrom) {
            return false;
        }

        if (filters.dateTo && date > filters.dateTo) {
            return false;
        }
    }

    return true;
}

async function yQueryAnimals(query) {
    const { filters, requestedPage } = yParseFilters(query);

    let total;
    let animals;

    const mongoFilter = yBuildMongoFilter(filters);

    total = await YAnimal.countDocuments(mongoFilter);

    const pageCount = Math.max(1, Math.ceil(total / RECORDS_PER_PAGE));

    const page = Math.min(requestedPage, pageCount);

    animals = await YAnimal.find(mongoFilter)
        .sort(Y_SORT_OPTIONS[filters.sort])
        .skip((page - 1) * RECORDS_PER_PAGE)
        .limit(RECORDS_PER_PAGE)
        .lean();

    return {
        filters,
        animals,
        total,
        page,
        pageCount,
        pageSize: RECORDS_PER_PAGE
    };
}

async function yQueryStats() {
    const rescueCounts = Object.entries(labels.rescueStatuses).map(([value, label]) => ({
        value,
        label,
        count: 0
    }));

    const adoptionCounts = Object.entries(labels.adoptionStatuses).map(
        ([value, label]) => ({
            value,
            label,
            count: 0
        })
    );

    const [total, rescueGroups, adoptionGroups, animals] = await Promise.all([
        YAnimal.countDocuments({}),

        YAnimal.aggregate([
            {
                $group: {
                    _id: '$rescueStatus',
                    count: {
                        $sum: 1
                    }
                }
            }
        ]),

        YAnimal.aggregate([
            {
                $group: {
                    _id: '$adoptionStatus',
                    count: {
                        $sum: 1
                    }
                }
            }
        ]),

        YAnimal.find({})
            .sort({
                updatedAt: -1,
                animalCode: 1
            })
            .limit(3)
            .lean()
    ]);

    for (const group of rescueGroups) {
        const item = rescueCounts.find((entry) => entry.value === group._id);

        if (item) {
            item.count = group.count;
        }
    }

    for (const group of adoptionGroups) {
        const item = adoptionCounts.find((entry) => entry.value === group._id);

        if (item) {
            item.count = group.count;
        }
    }

    return {
        total,
        rescueCounts,
        adoptionCounts,
        animals
    };
}

function yHandleError(error, req, res) {
    if (error.status === 400) {
        if (isApiRequest(req)) {
            return sendApiError(res, 400, 'VALIDATION_ERROR', error.message);
        }

        return res.status(400).render('info', {
            title: 'Invalid Search Filters',
            activePage: 'list',
            message: error.message
        });
    }

    console.error('Y module request failed: ', error.message);

    if (isApiRequest(req)) {
        return sendApiError(
            res,
            500,
            'INTERNAL_ERROR',
            'Could not load records or statistics.'
        );
    }

    return res.status(500).render('info', {
        title: 'Request Failed',
        activePage: '',
        message: 'This page is unavailable. Please try again.'
    });
}

app.get('/', requireLogin, yDatabaseAvailable, async (req, res) => {
    try {
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
        const [stats, dueFollowUps] = await Promise.all([
            yQueryStats(),
            FollowUp.aggregate([
                { $sort: { animalId: 1, createdAt: -1, _id: -1 } },
                { $group: { _id: '$animalId', due: { $first: '$nextFollowUpDate' } } },
                { $match: { due: { $type: 'string', $lte: today } } },
                {
                    $lookup: {
                        from: Animal.collection.name,
                        localField: '_id',
                        foreignField: '_id',
                        as: 'animal'
                    }
                },
                { $unwind: '$animal' },
                {
                    $match: {
                        'animal.closedAt': null,
                        'animal.adoptionStatus': { $ne: 'adopted' }
                    }
                },
                { $project: { due: 1, animalCode: '$animal.animalCode' } },
                { $sort: { due: 1, animalCode: 1 } }
            ])
        ]);

        return res.render('dashboard', {
            today,
            dueFollowUps,
            title: 'Dashboard',
            activePage: 'home',
            ...stats
        });
    } catch (error) {
        return yHandleError(error, req, res);
    }
});

app.get('/animals', requireLogin, yDatabaseAvailable, async (req, res) => {
    try {
        const result = await yQueryAnimals(req.query);
        const workspaceMode =
            {
                '/rescue-management': 'rescue',
                '/followup-records': 'followups',
                '/adoption-management': 'adoption'
            }[req.path] || 'list';
        const workspaceTitles = {
            list: 'Animal Records',
            rescue: 'Rescue Management',
            followups: 'Follow-up Records',
            adoption: 'Adoption Management'
        };

        const pageUrl = (number) => {
            const params = new URLSearchParams({
                ...result.filters,
                page: String(number)
            });

            return `${req.path}?${params.toString()}`;
        };

        return res.render('list', {
            title: workspaceTitles[workspaceMode],
            activePage: workspaceMode,
            workspaceMode,
            listPath: req.path,
            pageUrl,
            ...result
        });
    } catch (error) {
        return yHandleError(error, req, res);
    }
});

const workAreas = {
    '/rescue-management': {
        key: 'rescue',
        title: 'Rescue Management',
        description: 'Coordinate active cases, responsible staff and placement.',
        tabs: [
            ['active', 'Active Cases'],
            ['pending', 'Pending Rescue'],
            ['rescuing', 'In Rescue'],
            ['placed', 'Placed'],
            ['archived', 'Archived']
        ],
        defaultTab: 'active'
    },
    '/followup-records': {
        key: 'followups',
        title: 'Follow-up Records',
        description:
            'Read the care journal across animals. Each entry is a recorded observation.',
        tabs: [
            ['all', 'All Entries'],
            ['mine', 'My Entries'],
            ['new', 'Add Follow-up']
        ],
        defaultTab: 'all'
    },
    '/adoption-management': {
        key: 'adoption',
        title: 'Adoption Management',
        description:
            'Find available animals, continue applications and review adoption history.',
        tabs: [
            ['available', 'Available'],
            ['processing', 'In Progress'],
            ['completed', 'Completed'],
            ['cancelled', 'Cancelled'],
            ['not_open', 'Not Open']
        ],
        defaultTab: 'available'
    }
};

app.get(Object.keys(workAreas), requireLogin, yDatabaseAvailable, async (req, res) => {
    try {
        const area = workAreas[req.path];
        const tab = area.tabs.some(([key]) => key === req.query.tab)
            ? req.query.tab
            : area.defaultTab;
        const q = yReadQuery(req.query, 'q').toUpperCase();
        if (q.length > 100) throw yError('Animal code must be 100 characters or fewer.');
        const invalidAnimalCode = Boolean(q) && !animalCodePattern.test(q);
        const animalSearch = q ? { animalCode: q } : {};
        const open = { closedAt: null, adoptionStatus: { $ne: 'adopted' } };
        const assignedFilter = area.key === 'rescue' &&
            (req.query.assignedTo === 'me' ||
                (req.user.role === 'admin' && req.query.assignedTo === 'unassigned'))
            ? req.query.assignedTo : '';
        const assignedToMe = assignedFilter === 'me';
        let model = Animal;
        let where = animalSearch;
        const animalRows =
            area.key === 'rescue' ||
            (area.key === 'followups' && tab === 'new') ||
            (area.key === 'adoption' && ['available', 'not_open'].includes(tab));
        if (area.key === 'rescue') {
            where = {
                $and: [
                    animalSearch,
                    tab === 'archived'
                        ? {
                              $or: [
                                  { closedAt: { $ne: null } },
                                  { adoptionStatus: 'adopted' }
                              ]
                          }
                        : open
                ]
            };
            if (['pending', 'rescuing', 'placed'].includes(tab)) where.rescueStatus = tab;
            if (assignedToMe) where.assignedTo = req.user._id;
            else if (assignedFilter === 'unassigned') where.assignedTo = null;
        } else if (animalRows) {
            where = { ...animalSearch, ...open };
            if (area.key === 'adoption') where.adoptionStatus = tab;
        } else {
            const animalIds = invalidAnimalCode ? [] : await Animal.find(animalSearch).distinct('_id');
            where = { animalId: { $in: animalIds } };
            if (area.key === 'followups') {
                model = FollowUp;
                if (tab === 'mine') where.recordedBy = req.user._id;
            } else {
                model = LAdoption;
                if (tab === 'cancelled') where.cancelledAt = { $ne: null };
                else {
                    where.cancelledAt = null;
                    where.completedAt = tab === 'completed' ? { $ne: null } : null;
                }
            }
        }
        const total = invalidAnimalCode ? 0 : await model.countDocuments(where);
        const pageCount = Math.max(1, Math.ceil(total / RECORDS_PER_PAGE));
        const requested = Number(req.query.page);
        const page =
            Number.isSafeInteger(requested) && requested > 0
                ? Math.min(requested, pageCount)
                : 1;
        let query = model
            .find(where)
            .sort({ createdAt: -1, _id: -1 })
            .skip((page - 1) * RECORDS_PER_PAGE)
            .limit(RECORDS_PER_PAGE);
        if (animalRows) query = query.populate('assignedTo', 'displayName isActive');
        else
            query = query
                .populate('animalId')
                .populate(
                    area.key === 'followups' ? 'recordedBy' : 'registeredBy',
                    'displayName'
                );
        const rows = total ? await query.lean() : [];
        const urlFor = (nextTab = tab, nextPage = 1) =>
            req.path +
            '?' +
            new URLSearchParams({
                tab: nextTab,
                q,
                page: String(nextPage),
                ...(assignedFilter ? { assignedTo: assignedFilter } : {})
            }).toString();
        req.session.workReturns = {
            ...req.session.workReturns,
            [area.key]: urlFor(tab, page)
        };
        const notice = req.session.workNotice;
        const showNotice = notice?.path === req.path && notice.tab === tab &&
            rows.some(row => String(row._id) === notice.id);
        if (showNotice) delete req.session.workNotice;
        return res.render('work-area', {
            invalidAnimalCode,
            workNotice: showNotice ? notice : null,
            title: area.title,
            activePage: area.key,
            area,
            tab,
            q,
            rows,
            animalRows,
            total,
            page,
            pageCount,
            pageSize: RECORDS_PER_PAGE,
            urlFor,
            assignedFilter,
            basePath: req.path
        });
    } catch (error) {
        return yHandleError(error, req, res);
    }
});

app.get('/api/animals', requireLogin, yDatabaseAvailable, async (req, res) => {
    try {
        const result = await yQueryAnimals(req.query);

        return res.json({
            success: true,
            data: result.animals,
            filters: result.filters,
            pagination: {
                page: result.page,
                pageSize: result.pageSize,
                pageCount: result.pageCount,
                total: result.total
            }
        });
    } catch (error) {
        return yHandleError(error, req, res);
    }
});

app.get('/api/stats', requireLogin, yDatabaseAvailable, async (req, res) => {
    try {
        const stats = await yQueryStats();

        return res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        return yHandleError(error, req, res);
    }
});
// ============================================================================

// ============================================================================

// ============================================================================

// 04 M — Rescue and follow-up management
const RESCUE_STAGE = {
    pending: 1,
    rescuing: 2,
    placed: 3
};

function mFail(status, message) {
    const error = new Error(message);
    error.mStatus = status;
    throw error;
}

function mId(value) {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) {
        mFail(400, 'Invalid record ID.');
    }

    return value;
}

function mText(body, field, maxLength, required = true) {
    const value = body?.[field];

    if (!required && value === undefined) {
        return '';
    }

    if (typeof value !== 'string') {
        mFail(400, `${field} must be a string`);
    }

    const result = value.trim();

    if ((required && !result) || result.length > maxLength) {
        mFail(400, `${field} must be nonempty and within the length limit`);
    }

    return result;
}

function getStaffUserId(req) {
    if (!req.user?._id) {
        mFail(401, 'Please sign in.');
    }

    return req.user._id;
}

function mCanManageFollowUp(req, followUp) {
    if (!req.user || !followUp) return false;

    return (
        req.user.role === 'admin' || String(followUp.recordedBy) === String(req.user._id)
    );
}

async function mHandleError(error, req, res) {
    let status = error.mStatus || error.nStatus || 500;
    let message =
        error.mStatus || error.nStatus
            ? error.message
            : 'The server could not process this request.';

    if (error.name === 'CastError') {
        status = 400;
        message = 'Invalid record ID.';
    }

    if (error.name === 'ValidationError') {
        status = 400;
        message = 'Input does not meet the record requirements.';
    }

    if (status === 500) {
        console.error('M module error:', error);
    }

    if (isApiRequest(req)) {
        return sendApiError(
            res,
            status,
            status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED',
            message
        );
    }

    const validAnimalId = /^[a-f0-9]{24}$/i.test(req.params.id || '');
    try {
        if (
            validAnimalId &&
            req.method === 'POST' &&
            req.path.endsWith('/rescue') &&
            [400, 409].includes(status)
        ) {
            const current = await mGetAnimal(req.params.id);
            const users = await coordinatorChoices(current, req.user);
            const animal = current.toObject();
            for (const field of ['rescueStatus', 'placementLocation']) {
                if (typeof req.body[field] === 'string')
                    animal[field] = req.body[field].slice(0, 200);
            }
            return res.status(status).render('rescue', {
                title: 'Rescue Management',
                activePage: 'list',
                animal,
                users,
                error: message,
                stale: status === 409 || /expectedUpdatedAt/.test(message),
                expectedUpdatedAt:
                    req.body.expectedUpdatedAt || current.updatedAt.toISOString()
            });
        }
        const followRoute = req.path.match(
            /\/followups\/(new|[a-f0-9]{24}\/(edit|delete))$/i
        );
        if (
            validAnimalId &&
            req.method === 'POST' &&
            followRoute &&
            [400, 409].includes(status)
        ) {
            const animal = await mGetAnimal(req.params.id);
            const mode = followRoute[1] === 'new' ? 'create' : followRoute[2];
            const followUp =
                mode === 'create'
                    ? null
                    : await FollowUp.findOne({
                          _id: req.params.followId,
                          animalId: req.params.id
                      });
            if (
                animal &&
                !animal.closedAt &&
                animal.adoptionStatus !== 'adopted' &&
                (mode === 'create' || (followUp && mCanManageFollowUp(req, followUp)))
            ) {
                return res.status(status).render('followup', {
                    title:
                        mode === 'create'
                            ? 'Add Follow-up'
                            : mode === 'edit'
                              ? 'Edit Follow-up'
                              : 'Delete Follow-up',
                    activePage: 'list',
                    animal,
                    mode,
                    followUp,
                    error: message,
                    stale: status === 409 || /expectedUpdatedAt/.test(message),
                    draftNextDate: req.body.nextFollowUpDate,
                    draftContent:
                        typeof req.body.content === 'string' ? req.body.content : '',
                    expectedUpdatedAt:
                        typeof req.body.expectedUpdatedAt === 'string'
                            ? req.body.expectedUpdatedAt
                            : ''
                });
            }
        }
    } catch (recoveryError) {
        // Recovery must not turn a bad request or a deleted record into a server error.
        status =
            recoveryError.mStatus ||
            recoveryError.nStatus ||
            (recoveryError.name === 'CastError' ? 400 : 500);
        message =
            status === 500
                ? 'The server could not process this request.'
                : recoveryError.name === 'CastError'
                  ? 'Invalid record ID.'
                  : recoveryError.message;
        if (status === 500) console.error('M form recovery error:', recoveryError);
    }
    return res.status(status).render('info', {
        returnUrl:
            validAnimalId && status !== 404
                ? '/animals/' + req.params.id
                : req.path.includes('/followups')
                  ? '/followup-records'
                  : '/rescue-management',
        title: 'Action Failed',
        activePage: 'list',
        message
    });
}

async function mGetAnimal(id) {
    mId(id);

    const animal = await Animal.findById(id);

    if (!animal) {
        mFail(404, 'Animal record not found.');
    }

    return animal;
}

function mRequireOpen(animal) {
    if (animal.closedAt || animal.adoptionStatus === 'adopted') {
        mFail(403, 'This case is closed and cannot be changed.');
    }
}

// ---------------------- Rescue Management ----------------------

async function coordinatorChoices(animal, viewer) {
    const filter = viewer.role === 'admin'
        ? { $or: [{ isActive: { $ne: false } }, { _id: animal.assignedTo || null }] }
        : { _id: animal.assignedTo || null };
    return User.find(filter).select('displayName isActive').sort({ displayName: 1 }).lean();
}

function changeCoordinator(action) {
    return async (req, res) => {
        try {
            const animal = await nTransaction(req.params.id, async (record, session) => {
                mRequireOpen(record);
                if (action === 'assign' && req.user.role !== 'admin')
                    mFail(403, 'Only an administrator can assign or hand over a case.');
                if (action === 'claim' && record.assignedTo)
                    mFail(409, 'This case already has a coordinator.');
                mExpectedVersion(req.body?.expectedUpdatedAt, record.updatedAt);
                let coordinator = req.user._id;
                if (action === 'assign') {
                    coordinator = mId(req.body?.assignedTo);
                    if (!await User.exists({ _id: coordinator, isActive: { $ne: false },
                        role: { $in: ['admin', 'staff'] } }).session(session))
                        mFail(400, 'Choose an active rescue coordinator.');
                } else if (req.body?.assignedTo !== undefined) {
                    mFail(400, 'Take case assigns the case to your own account.');
                }
                record.assignedTo = coordinator;
                await record.save({ session });
                return record;
            }, req.user._id);
            if (isApiRequest(req)) return res.json({ success: true, data: animal });
            return res.redirect(303, '/animals/' + animal._id + '/rescue' + res.locals.carryReturn);
        } catch (error) {
            return mHandleError(error, req, res);
        }
    };
}

for (const action of ['claim', 'assign']) {
    const handler = changeCoordinator(action);
    app.post('/animals/:id/' + action, requireLogin, requireCsrf, handler);
    app.put('/api/animals/:id/' + action, requireLogin, requireCsrf, handler);
}

app.get('/animals/:id/rescue', requireLogin, async (req, res) => {
    try {
        const animal = await mGetAnimal(req.params.id);

        const users = await coordinatorChoices(animal, req.user);

        return res.render('rescue', {
            title: 'Rescue Management',
            activePage: 'list',
            animal,
            users,
            adoption: null,
            error: '',
            stale: false,
            expectedUpdatedAt: animal.updatedAt.toISOString()
        });
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

async function mUpdateRescue(req) {
    return nTransaction(req.params.id, async (animal, session) => {
        mRequireOpen(animal);
        requireCaseManager(req.user, animal);
        mExpectedVersion(req.body?.expectedUpdatedAt, animal.updatedAt);

        const newStatus = mText(req.body, 'rescueStatus', 20);

        if (!Object.hasOwn(RESCUE_STAGE, newStatus)) {
            mFail(400, 'Invalid rescue stage.');
        }

        const currentRank = RESCUE_STAGE[animal.rescueStatus];
        const targetRank = RESCUE_STAGE[newStatus];

        if (targetRank < currentRank) {
            mFail(400, 'Rescue progress cannot move backwards.');
        }

        const assignedTo = animal.assignedTo;
        if (req.body.assignedTo !== undefined && req.body.assignedTo !== String(assignedTo || ''))
            mFail(req.user.role === 'admin' ? 400 : 403, 'Use the separate coordinator assignment action.');

        const locationInput = req.body?.placementLocation;

        if (locationInput !== undefined && typeof locationInput !== 'string') {
            mFail(400, 'Invalid placement location format.');
        }

        const placementLocation =
            locationInput === undefined ? animal.placementLocation : locationInput.trim();

        if (placementLocation.length > 200) {
            mFail(400, 'Placement location must be at most 200 characters.');
        }

        if (assignedTo) {
            const userId = mId(String(assignedTo));

            const userExists = await User.exists({
                _id: userId,
                role: {
                    $in: ['staff', 'admin']
                },
                isActive: {
                    $ne: false
                }
            });

            if (!userExists) {
                mFail(400, 'Assignee not found or account disabled.');
            }
        }

        if ((newStatus === 'rescuing' || newStatus === 'placed') && !assignedTo) {
            mFail(400, 'Assign a staff member before moving to In Rescue or Placed.');
        }

        if (newStatus === 'placed' && !placementLocation) {
            mFail(400, 'Enter a placement location before moving to Placed.');
        }

        Object.assign(animal, {
            rescueStatus: newStatus,
            placementLocation
        });
        await animal.save({
            session
        });
        return animal;
    }, req.user._id);
}

function mExpectedVersion(value, timestamp) {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    ) {
        mFail(400, 'A valid expectedUpdatedAt is required. Reload the record.');
    }
    if (value !== timestamp.toISOString())
        mFail(409, 'This record has changed. Reload before saving.');
}

app.post('/animals/:id/rescue', requireLogin, requireCsrf, async (req, res) => {
    try {
        const animal = await mUpdateRescue(req);
        const path = '/animals/' + animal._id;
        req.session.workNotice = {
            path,
            id: String(animal._id),
            message: animal.animalCode + ' — rescue details saved.'
        };
        return res.redirect(303, path + res.locals.carryReturn);
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

app.put('/api/animals/:id/rescue', requireLogin, requireCsrf, async (req, res) => {
    try {
        const animal = await mUpdateRescue(req);

        return res.json({
            success: true,
            message: 'Rescue details saved.',
            data: animal
        });
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

// ---------------------- Follow-up Management ----------------------

async function renderFollowUpView(req, res, mode) {
    try {
        const animal = await mGetAnimal(req.params.id);
        mRequireOpen(animal);

        let followUp = null;

        if (mode !== 'create') {
            const followId = mId(req.params.followId);

            followUp = await FollowUp.findOne({
                _id: followId,
                animalId: animal._id
            });

            if (!followUp) {
                mFail(404, 'Follow-up not found.');
            }

            if (mode === 'delete' && req.user.role !== 'admin')
                mFail(403, 'Only an administrator can delete a follow-up.');
            if (!mCanManageFollowUp(req, followUp)) {
                mFail(403, 'Only the author or an administrator can change this entry.');
            }
        }

        const titles = {
            create: 'Add Follow-up',
            edit: 'Edit Follow-up',
            delete: 'Delete Follow-up'
        };

        return res.render('followup', {
            title: titles[mode],
            activePage: 'list',
            animal,
            mode,
            followUp
        });
    } catch (error) {
        return mHandleError(error, req, res);
    }
}

app.get('/animals/:id/followups/new', requireLogin, (req, res) =>
    renderFollowUpView(req, res, 'create')
);

app.get('/animals/:id/followups/:followId/edit', requireLogin, (req, res) =>
    renderFollowUpView(req, res, 'edit')
);

app.get('/animals/:id/followups/:followId/delete', requireLogin, (req, res) =>
    renderFollowUpView(req, res, 'delete')
);

function mNextFollowUpDate(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || !yValidDate(value)) {
        mFail(400, 'Enter a valid next follow-up date.');
    }
    return value;
}

async function mCreateFollowUp(req) {
    const content = mText(req.body, 'content', 2000);
    return nTransaction(req.params.id, async (animal, session) => {
        mRequireOpen(animal);
        const [record] = await FollowUp.create(
            [
                {
                    animalId: animal._id,
                    content,
                    nextFollowUpDate: mNextFollowUpDate(req.body.nextFollowUpDate),
                    recordedBy: getStaffUserId(req)
                }
            ],
            {
                session
            }
        );
        return record;
    }, req.user._id);
}

app.post('/animals/:id/followups/new', requireLogin, requireCsrf, async (req, res) => {
    try {
        const entry = await mCreateFollowUp(req);
        const source = new URL(res.locals.backSource?.url || '/', 'http://localhost');
        if (source.pathname === '/followup-records' && source.searchParams.get('tab') === 'new') {
            return await redirectToWorkRecord(
                req, res, '/followup-records', 'all', FollowUp, {},
                entry, 'Follow-up saved.'
            );
        }
        return res.redirect(
            303,
            res.locals.backSource?.url || '/animals/' + req.params.id + '#care-journal'
        );
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

app.get('/api/animals/:id/followups', requireLogin, async (req, res) => {
    try {
        const animal = await mGetAnimal(req.params.id);

        const records = await FollowUp.find({
            animalId: animal._id
        }).sort({
            createdAt: -1,
            _id: -1
        });

        return res.json({
            success: true,
            data: records
        });
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

app.post('/api/animals/:id/followups', requireLogin, requireCsrf, async (req, res) => {
    try {
        const record = await mCreateFollowUp(req);
        return res.status(201).json({
            success: true,
            data: record
        });
    } catch (error) {
        return mHandleError(error, req, res);
    }
});

async function mUpdateFollowUp(req) {
    return nTransaction(req.params.id, async (animal, session) => {
        mRequireOpen(animal);

        const followId = mId(req.params.followId);
        const content = mText(req.body, 'content', 2000);

        const followUp = await FollowUp.findOne({
            _id: followId,
            animalId: animal._id
        }).session(session);

        if (!followUp) {
            mFail(404, 'Follow-up not found.');
        }

        if (!mCanManageFollowUp(req, followUp)) {
            mFail(403, 'Only the author or an administrator can edit this entry.');
        }

        mExpectedVersion(req.body?.expectedUpdatedAt, followUp.updatedAt);
        const conditions = {
            _id: followUp._id,
            animalId: animal._id
        };

        if (req.user.role !== 'admin') {
            conditions.recordedBy = req.user._id;
        }

        const updated = await FollowUp.findOneAndUpdate(
            conditions,
            {
                $set: {
                    content,
                    ...(req.body.nextFollowUpDate === undefined
                        ? {}
                        : {
                              nextFollowUpDate: mNextFollowUpDate(req.body.nextFollowUpDate)
                          }),
                    updatedAt: new Date(
                        Math.max(Date.now(), followUp.updatedAt.getTime() + 1)
                    ),
                    updatedBy: getStaffUserId(req)
                }
            },
            {
                session,
                returnDocument: 'after',
                timestamps: false,
                runValidators: true
            }
        );

        if (!updated) {
            mFail(409, 'This record has changed. Reload and try again.');
        }

        return updated;
    }, req.user._id);
}

app.post(
    '/animals/:id/followups/:followId/edit',
    requireLogin,
    requireCsrf,
    async (req, res) => {
        try {
            await mUpdateFollowUp(req);
            return res.redirect(
                303,
                res.locals.backSource?.url || '/animals/' + req.params.id + '#care-journal'
            );
        } catch (error) {
            return mHandleError(error, req, res);
        }
    }
);

app.put(
    '/api/animals/:id/followups/:followId',
    requireLogin,
    requireCsrf,
    async (req, res) => {
        try {
            const record = await mUpdateFollowUp(req);
            return res.json({
                success: true,
                data: record
            });
        } catch (error) {
            return mHandleError(error, req, res);
        }
    }
);

async function mDeleteFollowUp(req) {
    return nTransaction(req.params.id, async (animal, session) => {
        mRequireOpen(animal);

        const followId = mId(req.params.followId);

        const followUp = await FollowUp.findOne({
            _id: followId,
            animalId: animal._id
        }).session(session);

        if (!followUp) {
            mFail(404, 'Follow-up not found.');
        }

        if (req.user.role !== 'admin') {
            mFail(403, 'Only an administrator can delete a follow-up.');
        }

        mExpectedVersion(req.body?.expectedUpdatedAt, followUp.updatedAt);
        const deleted = await FollowUp.findOneAndDelete({
            _id: followUp._id,
            animalId: animal._id
        }, { session });

        if (!deleted) {
            mFail(409, 'This record has changed. Reload and try again.');
        }

        return deleted;
    }, req.user._id);
}

app.post(
    '/animals/:id/followups/:followId/delete',
    requireLogin,
    requireCsrf,
    async (req, res) => {
        try {
            await mDeleteFollowUp(req);
            return res.redirect(
                303,
                res.locals.backSource?.url || '/animals/' + req.params.id + '#care-journal'
            );
        } catch (error) {
            return mHandleError(error, req, res);
        }
    }
);

app.delete(
    '/api/animals/:id/followups/:followId',
    requireLogin,
    requireCsrf,
    async (req, res) => {
        try {
            await mDeleteFollowUp(req);

            return res.json({
                success: true,
                message: 'Follow-up deleted.'
            });
        } catch (error) {
            return mHandleError(error, req, res);
        }
    }
);

// ============================================================================

// ============================================================================

// ============================================================================

// 05 N — Adoption, closure and audited deletion
const { timingSafeEqual: nTimingSafeEqual } = require('node:crypto');
let nModels;

function nGetModels() {
    if (!nModels)
        nModels = {
            Animal: require('./models/Animal'),
            Adoption: require('./models/Adoption'),
            FollowUp: require('./models/FollowUp'),
            User: require('./models/User'),
            DeletionLog: require('./models/DeletionLog')
        };
    return nModels;
}

function nFail(status, code, message) {
    const error = new Error(message);
    Object.assign(error, {
        nStatus: status,
        nCode: code
    });
    throw error;
}

function nId(value) {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) {
        nFail(400, 'INVALID_ID', 'Invalid animal ID.');
    }
    return value;
}

function nText(body, key, maximum, required = true) {
    const value = body?.[key];
    if (!required && value === undefined) return '';
    if (typeof value !== 'string')
        nFail(400, 'VALIDATION_ERROR', 'Form fields must contain text.');
    const text = value.trim();
    if ((required && !text) || text.length > maximum) {
        const label =
            {
                adopterName: 'Name',
                adopterPhone: 'Phone',
                remarks: 'Notes',
                cancellationReason: 'Cancellation Reason',
                deletionReason: 'Reason for Deletion'
            }[key] || key;
        nFail(
            400,
            'VALIDATION_ERROR',
            label + 'must be nonempty and no longer than ' + maximum + ' characters'
        );
    }
    if (key === 'adopterPhone') {
        const phone = normalizePhone(value, body.phoneCode);
        if (!phone) nFail(400, 'VALIDATION_ERROR', phoneHint);
        return phone;
    }
    return text;
}

function nConfirmed(value) {
    return value === true || value === 'yes';
}

function nDatabase() {
    if (mongoose.connection.readyState !== 1)
        nFail(
            503,
            'DATABASE_UNAVAILABLE',
            'Database unavailable. Contact the administrator.'
        );
}

async function nPrepareDatabase() {
    nDatabase();
    const models = nGetModels();
    for (const Model of Object.values(models)) await Model.init();
    await models.Adoption.createIndexes();
    await models.User.updateMany(
        {
            isActive: {
                $exists: false
            }
        },
        {
            $set: {
                isActive: true
            }
        }
    );
    for (const [username, oldName, displayName] of [
        ['staff01', '\u5de5\u4f5c\u4eba\u545801', 'Staff 01'],
        ['admin01', '\u7ba1\u7406\u545801', 'Administrator 01']
    ]) {
        await models.User.updateOne(
            {
                username,
                displayName: oldName
            },
            {
                $set: {
                    displayName
                }
            }
        );
    }

    const indexes = await models.Adoption.collection.indexes();
    const old = indexes.find(
        (index) =>
            index.name === 'animalId_1' &&
            index.unique === true &&
            index.key.animalId === 1 &&
            Object.keys(index.key).length === 1 &&
            !index.partialFilterExpression
    );
    if (old) await models.Adoption.collection.dropIndex(old.name);
    await migrateAnimalCodes();
}
async function nTransaction(id, work, updatedBy = null) {
    nId(id);
    nDatabase();
    const hello = await mongoose.connection.db.admin().command({
        hello: 1
    });
    if (!hello.setName && hello.msg !== 'isdbgrid') {
        nFail(
            503,
            'TRANSACTIONS_REQUIRED',
            'A MongoDB replica set is required for transactions. See README.'
        );
    }
    const { Animal } = nGetModels();
    return mongoose.connection.transaction(
        async (session) => {
            const animal = await Animal.findOneAndUpdate(
                {
                    _id: id
                },
                {
                    $set: { updatedBy },
                    $inc: {
                        __v: 1
                    }
                },
                {
                    session,
                    returnDocument: 'after',
                    runValidators: true,
                    timestamps: false
                }
            );
            if (!animal) nFail(404, 'NOT_FOUND', 'Animal record not found.');
            const result = await work(animal, session);
            const updatedAt = new Date(
                Math.max(Date.now(), animal.updatedAt.getTime() + 1)
            );
            await Animal.updateOne(
                {
                    _id: id
                },
                {
                    $set: {
                        updatedAt
                    }
                },
                {
                    session,
                    timestamps: false
                }
            );
            if (result?.animal) result.animal.updatedAt = updatedAt;
            if (result?.constructor?.modelName === 'Animal') result.updatedAt = updatedAt;
            return result;
        },
        {
            readConcern: {
                level: 'snapshot'
            },
            writeConcern: {
                w: 'majority'
            },
            maxCommitTimeMS: 10000
        }
    );
}

function nOpenAnimal(animal) {
    if (animal.closedAt || animal.adoptionStatus === 'adopted')
        nFail(409, 'CASE_CLOSED', 'This case is closed and read-only.');
}
async function nRead(id) {
    nId(id);
    nDatabase();
    const { Animal, Adoption } = nGetModels();
    const animal = await Animal.findById(id).lean();
    if (!animal) nFail(404, 'NOT_FOUND', 'Animal record not found.');
    const adoption = await Adoption.findOne({
        animalId: id,
        cancelledAt: null
    }).lean();
    const adoptionHistory = await Adoption.find({
        animalId: id,
        cancelledAt: {
            $ne: null
        }
    })
        .sort({
            cancelledAt: -1,
            _id: -1
        })
        .populate('cancelledBy', 'displayName')
        .lean();
    return {
        animal,
        adoption,
        adoptionHistory
    };
}
async function nChangeStatus(id, body, user) {
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        requireCaseManager(user, animal);
        const target = body?.adoptionStatus;
        if (!['available', 'not_open'].includes(target))
            nFail(400, 'VALIDATION_ERROR', 'Only opening or withdrawing adoption is allowed.');
        if (target === 'available' && !nConfirmed(body?.healthConfirmed)) {
            nFail(
                400,
                'HEALTH_CONFIRMATION_REQUIRED',
                'Confirm the animal is healthy enough for adoption.'
            );
        }
        const expected = target === 'available' ? 'not_open' : 'available';
        if (animal.adoptionStatus !== expected)
            nFail(
                409,
                'STATE_CONFLICT',
                'The adoption state has changed. Reload this page.'
            );
        if (
            target === 'available' &&
            (animal.rescueStatus !== 'placed' ||
                !animal.assignedTo ||
                !animal.placementLocation.trim())
        ) {
            nFail(
                409,
                'NOT_PLACED',
                'Assign a staff member and placement before opening adoption.'
            );
        }
        const adoption = await nGetModels()
            .Adoption.findOne({
                animalId: id,
                cancelledAt: null
            })
            .session(session);
        if (adoption)
            nFail(
                409,
                'ADOPTION_EXISTS',
                'An adoption already exists; availability cannot be changed.'
            );
        animal.adoptionStatus = target;
        await animal.save({
            session
        });
        return {
            animal: animal.toObject()
        };
    }, user._id);
}
async function nRegister(id, body, user) {
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        requireCaseManager(user, animal);
        const fields = {
            adopterName: nText(body, 'adopterName', 80),
            adopterPhone: nText(body, 'adopterPhone', 30),
            remarks: nText(body, 'remarks', 2000, false)
        };
        if (animal.adoptionStatus !== 'available' || animal.rescueStatus !== 'placed') {
            nFail(
                409,
                'STATE_CONFLICT',
                'Only placed, available animals can be registered for adoption.'
            );
        }
        const { Adoption } = nGetModels();
        if (
            await Adoption.exists({
                animalId: id,
                cancelledAt: null
            }).session(session)
        )
            nFail(409, 'ADOPTION_EXISTS', 'An adoption already exists.');
        const [adoption] = await Adoption.create(
            [
                {
                    ...fields,
                    animalId: id,
                    registeredBy: user._id
                }
            ],
            {
                session
            }
        );
        animal.adoptionStatus = 'processing';
        await animal.save({
            session
        });
        return {
            animal: animal.toObject(),
            adoption: adoption.toObject()
        };
    }, user._id);
}

function nAdoptionVersion(body, adoption) {
    if (
        typeof body?.adoptionId !== 'string' ||
        !/^[a-fA-F0-9]{24}$/.test(body.adoptionId)
    ) {
        nFail(
            400,
            'INVALID_ADOPTION',
            'A valid adoption ID is required. Reload this page.'
        );
    }
    const raw = body.adoptionVersion;
    if (
        !['string', 'number'].includes(typeof raw) ||
        !/^(0|[1-9][0-9]*)$/.test(String(raw)) ||
        !Number.isSafeInteger(Number(raw))
    ) {
        nFail(400, 'INVALID_VERSION', 'Invalid adoption version. Reload this page.');
    }
    if (
        String(adoption._id) !== body.adoptionId.toLowerCase() ||
        (adoption.__v || 0) !== Number(raw)
    ) {
        nFail(
            409,
            'STALE_ADOPTION',
            'This adoption has changed or was cancelled. Reload before continuing.'
        );
    }
}
async function nProcessingAdoption(animal, session, body) {
    if (animal.adoptionStatus !== 'processing')
        nFail(
            409,
            'STATE_CONFLICT',
            'Only an adoption in progress can be edited or cancelled.'
        );
    const adoption = await nGetModels()
        .Adoption.findOne({
            animalId: animal._id,
            cancelledAt: null
        })
        .session(session);
    if (!adoption || adoption.completedAt)
        nFail(409, 'STATE_CONFLICT', 'There is no current adoption to update.');
    nAdoptionVersion(body, adoption);
    return adoption;
}
async function nEditAdoption(id, body, user) {
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        requireCaseManager(user, animal);
        const fields = {
            adopterName: nText(body, 'adopterName', 80),
            adopterPhone: nText(body, 'adopterPhone', 30),
            remarks: nText(body, 'remarks', 2000, false)
        };
        const adoption = await nProcessingAdoption(animal, session, body);
        Object.assign(adoption, fields, {
            updatedBy: user._id
        });
        adoption.__v = (adoption.__v || 0) + 1;
        await adoption.save({
            session
        });
        return {
            animal: animal.toObject(),
            adoption: adoption.toObject()
        };
    }, user._id);
}
async function nCancelAdoption(id, body, user) {
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        requireCaseManager(user, animal);
        const reason = nText(body, 'cancellationReason', 1000);
        if (!nConfirmed(body?.confirm))
            nFail(400, 'CONFIRMATION_REQUIRED', 'Confirm cancellation of this adoption.');
        const adoption = await nProcessingAdoption(animal, session, body);
        adoption.cancelledAt = new Date();
        adoption.cancelledBy = user._id;
        adoption.cancellationReason = reason;
        adoption.updatedBy = user._id;
        adoption.__v = (adoption.__v || 0) + 1;
        await adoption.save({
            session
        });
        animal.adoptionStatus = 'available';
        await animal.save({
            session
        });
        return {
            animal: animal.toObject(),
            cancelledAdoption: adoption.toObject()
        };
    }, user._id);
}

async function nClose(id, body, user) {
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        requireCaseManager(user, animal);
        if (!nConfirmed(body?.confirm))
            nFail(400, 'CONFIRMATION_REQUIRED', 'Confirm the adoption details and handover.');
        if (animal.adoptionStatus !== 'processing' || animal.rescueStatus !== 'placed') {
            nFail(
                409,
                'STATE_CONFLICT',
                'Only placed animals with an adoption in progress can be closed.'
            );
        }
        const { Adoption } = nGetModels();
        const adoption = await Adoption.findOne({
            animalId: id,
            cancelledAt: null
        }).session(session);
        if (!adoption || adoption.completedAt)
            nFail(
                409,
                'STATE_CONFLICT',
                'Adoption missing or already completed. Reload the record.'
            );
        nAdoptionVersion(body, adoption);
        const completedAt = new Date();
        adoption.completedAt = completedAt;
        adoption.updatedBy = user._id;
        adoption.__v = (adoption.__v || 0) + 1;
        animal.adoptionStatus = 'adopted';
        animal.closedAt = completedAt;
        animal.closedBy = user._id;
        await adoption.save({
            session
        });
        await animal.save({
            session
        });
        return {
            animal: animal.toObject(),
            adoption: adoption.toObject()
        };
    }, user._id);
}
async function nDelete(id, body, user) {
    if (user.role !== 'admin')
        nFail(403, 'FORBIDDEN', 'Only administrators can delete animal records.');
    if (!nConfirmed(body?.confirm))
        nFail(
            400,
            'CONFIRMATION_REQUIRED',
            'Confirm this record is incorrect or duplicated.'
        );
    const reason = nText(body, 'deletionReason', 1000);
    return nTransaction(id, async (animal, session) => {
        nOpenAnimal(animal);
        const { Animal, FollowUp, Adoption, DeletionLog } = nGetModels();
        const followUps = await FollowUp.deleteMany(
            {
                animalId: id
            },
            {
                session
            }
        );
        const adoptions = await Adoption.deleteMany(
            {
                animalId: id
            },
            {
                session
            }
        );
        await DeletionLog.create(
            [
                {
                    animalId: animal._id,
                    animalCode: animal.animalCode,
                    appearance: animal.appearance,
                    reason,
                    deletedBy: user._id,
                    deletedAt: new Date(),
                    deletedFollowUps: followUps.deletedCount,
                    deletedAdoptions: adoptions.deletedCount
                }
            ],
            {
                session
            }
        );
        await Animal.deleteOne(
            {
                _id: id
            },
            {
                session
            }
        );
        return {
            _id: String(animal._id),
            deletedFollowUps: followUps.deletedCount,
            deletedAdoptions: adoptions.deletedCount
        };
    }, user._id);
}

function nErrorInfo(error) {
    if (error.nStatus)
        return {
            status: error.nStatus,
            code: error.nCode,
            message: error.message
        };
    if (error.code === 11000)
        return {
            status: 409,
            code: 'ADOPTION_EXISTS',
            message: 'An adoption already exists. Reload the record.'
        };
    if (error.name === 'ValidationError')
        return {
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'Submitted data does not meet the field requirements.'
        };
    const unavailable = /ServerSelection|Network|NotConnected/.test(error.name || '');
    return {
        status: unavailable ? 503 : 500,
        code: unavailable ? 'DATABASE_UNAVAILABLE' : 'INTERNAL_ERROR',
        message:
            'The result could not be confirmed. Reload and check before submitting again.'
    };
}

function nApi(req) {
    return req.path.startsWith('/api/');
}

function nReplyError(req, res, error) {
    const info = nErrorInfo(error);
    if (info.status >= 500)
        console.error(
            'N module operation failed: ',
            error.name || info.code,
            error.code || ''
        );
    if (nApi(req))
        return res.status(info.status).json({
            success: false,
            error: {
                code: info.code,
                message: info.message
            }
        });
    return res.status(info.status).render('info', {
        title: 'Action Not Completed',
        activePage: 'list',
        message: info.message
    });
}

async function nRequireLogin(req, res, next) {
    res.locals.nLive = true;
    res.set('Cache-Control', 'no-store');
    try {
        if (!req.user?._id) {
            if (!nApi(req)) return res.redirect(303, '/login');
            nFail(401, 'UNAUTHENTICATED', 'Please sign in.');
        }
        nDatabase();
        const user = await nGetModels()
            .User.findById(req.user._id)
            .select('_id username displayName role isActive')
            .lean();
        if (!user || user.isActive === false || !['staff', 'admin'].includes(user.role)) {
            req.user = null;
            req.session = null;
            if (!nApi(req)) return res.redirect(303, '/login');
            nFail(401, 'UNAUTHENTICATED', 'Your account is no longer active.');
        }
        req.user = user;
        res.locals.currentUser = user;
        if (!req.session)
            nFail(503, 'SESSION_UNAVAILABLE', 'Sign-in session is unavailable.');
        if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
        res.locals.csrfToken = req.session.csrfToken;
        res.set('X-CSRF-Token', req.session.csrfToken);
        next();
    } catch (error) {
        return nReplyError(req, res, error);
    }
}

function nRequireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return nReplyError(req, res, {
            nStatus: 403,
            nCode: 'FORBIDDEN',
            message: 'Only administrators can delete animal records.'
        });
    }
    next();
}

function nCheckCsrf(req, res, next) {
    const supplied = req.get('X-CSRF-Token') || req.body?._csrf;
    const expected = req.session?.csrfToken;
    const a = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0);
    const b = typeof expected === 'string' ? Buffer.from(expected) : Buffer.alloc(0);
    if (!a.length || a.length !== b.length || !nTimingSafeEqual(a, b)) {
        return nReplyError(req, res, {
            nStatus: 403,
            nCode: 'CSRF_INVALID',
            message: 'This form has expired. Reload before submitting.'
        });
    }
    next();
}
async function nRender(req, res, view, error = null, status = 200) {
    const data = await nRead(req.params.id);
    if (view !== 'delete' && !data.animal.closedAt && data.animal.adoptionStatus !== 'adopted')
        requireCaseManager(req.user, data.animal);
    if (['delete', 'cancel-adoption'].includes(view)) nOpenAnimal(data.animal);
    if (
        view === 'cancel-adoption' &&
        (!data.adoption || data.animal.adoptionStatus !== 'processing')
    )
        nFail(409, 'STATE_CONFLICT', 'There is no adoption in progress to cancel.');

    const values = {};
    for (const [key, limit] of [
        ['adopterName', 80],
        ['adopterPhone', 30],
        ['remarks', 2000],
        ['cancellationReason', 1000],
        ['deletionReason', 1000]
    ]) {
        values[key] =
            error && typeof req.body?.[key] === 'string'
                ? req.body[key].slice(0, limit)
                : '';
    }
    if (view === 'delete') {
        const path = '/animals/' + data.animal._id;
        res.locals.cancelUrl = res.locals.backSource?.url || path + '/adoption';
        res.locals.cancelLabel =
            'Back to ' + (res.locals.backSource?.label || 'Adoption Management');
        res.locals.deleteAction = path + '/delete' + res.locals.carryReturn;
    }
    return res.status(status).render(view, {
        ...data,
        values,
        error,
        stale: status === 409,
        formAction: req.path.split('/').pop(),
        title: {
            'cancel-adoption': 'Cancel Adoption',
            adoption: 'Adoption Management',
            close: 'Complete Adoption',
            delete: 'Delete Animal Record'
        }[view],
        activePage: 'list'
    });
}

async function redirectToWorkRecord(req, res, path, tab, model, filter, record, message) {
    const preceding = await model.countDocuments({
        ...filter,
        $or: [
            { createdAt: { $gt: record.createdAt } },
            { createdAt: record.createdAt, _id: { $gt: record._id } }
        ]
    });
    const page = Math.floor(preceding / 10) + 1;
    req.session.workNotice = { path, tab, id: String(record._id), message };
    return res.redirect(303, path + '?tab=' + tab + '&page=' + page + '#record-' + record._id);
}

function nRegisterRoutes(target) {
    target.get('/animals/:id/adoption/cancel', nRequireLogin, async (req, res) => {
        try {
            return await nRender(req, res, 'cancel-adoption');
        } catch (error) {
            return nReplyError(req, res, error);
        }
    });
    target.get('/animals/:id/deletion-result', nRequireLogin, nRequireAdmin, (req, res) => {
        if (req.session.nDeletedAnimal !== req.params.id)
            return nReplyError(req, res, {
                nStatus: 404,
                nCode: 'NOT_FOUND',
                message: 'Deletion confirmation not found.'
            });
        return res.render('info', {
            title: 'Record Deleted',
            activePage: 'list',
            message:
                'The animal and its related follow-up and adoption records have been deleted.'
        });
    });
    for (const view of ['adoption', 'close', 'delete']) {
        const guards = view === 'delete' ? [nRequireLogin, nRequireAdmin] : [nRequireLogin];
        target.get('/animals/:id/' + view, ...guards, async (req, res) => {
            try {
                await nRender(req, res, view);
            } catch (error) {
                nReplyError(req, res, error);
            }
        });
    }
    target.get('/api/animals/:id/adoption', nRequireLogin, async (req, res) => {
        try {
            res.json({
                success: true,
                data: await nRead(req.params.id)
            });
        } catch (error) {
            nReplyError(req, res, error);
        }
    });
    const actions = [
        [
            'adoption-status',
            'put',
            '/api/animals/:id/adoption-status',
            nChangeStatus,
            'adoption',
            200
        ],
        ['adoption', 'post', '/api/animals/:id/adoption', nRegister, 'adoption', 201],
        [
            'adoption/edit',
            'put',
            '/api/animals/:id/adoption',
            nEditAdoption,
            'adoption',
            200
        ],
        [
            'adoption/cancel',
            'put',
            '/api/animals/:id/adoption/cancel',
            nCancelAdoption,
            'cancel-adoption',
            200
        ],
        ['close', 'put', '/api/animals/:id/close', nClose, 'close', 200],
        ['delete', 'delete', '/api/animals/:id', nDelete, 'delete', 200]
    ];
    for (const [suffix, method, apiPath, operation, view, successStatus] of actions) {
        const guards =
            suffix === 'delete'
                ? [nRequireLogin, nRequireAdmin, nCheckCsrf]
                : [nRequireLogin, nCheckCsrf];
        const handler = async (req, res) => {
            try {
                const data = await operation(req.params.id, req.body, req.user);
                if (nApi(req))
                    return res.status(successStatus).json({
                        success: true,
                        data,
                        message: 'Changes saved.'
                    });

                if (suffix === 'delete') {
                    req.session.nDeletedAnimal = req.params.id;
                    return res.redirect(
                        303,
                        '/animals/' + req.params.id + '/deletion-result'
                    );
                }
                if (suffix !== 'close') {
                    const tab = data.animal.adoptionStatus;
                    const processing = tab === 'processing';
                    const messages = {
                        'adoption-status': tab === 'available'
                            ? 'is now available for adoption.'
                            : 'has been withdrawn from adoption.',
                        adoption: '— adoption application registered.',
                        'adoption/edit': '— adopter details updated.',
                        'adoption/cancel': '— application cancelled. Available for adoption again.'
                    };
                    return await redirectToWorkRecord(
                        req, res, '/adoption-management', tab,
                        processing ? LAdoption : Animal,
                        processing ? { cancelledAt: null, completedAt: null } :
                            { adoptionStatus: tab, closedAt: null },
                        processing ? data.adoption : data.animal,
                        data.animal.animalCode + ' ' + messages[suffix]
                    );
                }
                const target =
                    '/animals/' +
                    req.params.id +
                    '/' +
                    (suffix === 'close' ? 'close' : 'adoption');
                const back = res.locals.backSource?.url;
                return res.redirect(
                    303,
                    back && back.split(/[?#]/)[0] === target
                        ? back
                        : target + res.locals.carryReturn
                );
            } catch (error) {
                const info = nErrorInfo(error);
                if (!nApi(req) && [400, 409].includes(info.status)) {
                    try {
                        return await nRender(req, res, view, info.message, info.status);
                    } catch (readError) {
                        return nReplyError(req, res, readError);
                    }
                }
                return nReplyError(req, res, error);
            }
        };
        target.post('/animals/:id/' + suffix, ...guards, handler);
        target[method](apiPath, ...guards, handler);
    }
}
nRegisterRoutes(app);

async function nRunIntegrationTests() {
    if (process.env.NODE_ENV !== 'test')
        throw new Error('Use NODE_ENV=test npm run test:n');
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const databaseName = 'group007_n_test_' + randomBytes(10).toString('hex');
    const uri =
        process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27018/?replicaSet=group007rs';
    let httpServer;
    let count = 0;
    const passed = (label) => {
        count++;
        console.log('PASS ' + count + ' ' + label);
    };
    try {
        await mongoose.connect(uri, {
            dbName: databaseName,
            serverSelectionTimeoutMS: 5000
        });
        const hello = await mongoose.connection.db.admin().command({
            hello: 1
        });
        assert.ok(
            hello.setName,
            'Tests require a replica set; transaction checks cannot be skipped.'
        );
        await nPrepareDatabase();
        const { User, Animal, Adoption, FollowUp, DeletionLog } = nGetModels();
        const password = randomBytes(24).toString('hex');
        const passwordHash = await hashPassword(password);
        const staff = await User.create({
            username: 'n_test_staff',
            passwordHash,
            displayName: 'Test Staff',
            role: 'staff'
        });
        const colleague = await User.create({
            username: 'n_test_colleague', passwordHash, displayName: 'Test Colleague', role: 'staff'
        });
        const admin = await User.create({
            username: 'n_test_admin',
            passwordHash,
            displayName: 'Test Administrator',
            role: 'admin'
        });
        let serial = 0;
        async function animal(overrides = {}) {
            return Animal.create({
                animalCode: 'NTEST-' + ++serial,
                animalType: 'cat',
                appearance: 'Orange and white cat',
                foundLocation: 'Test Location',
                healthStatus: 'Assessed',
                contactName: 'Test Contact',
                contactPhone: '00000000',
                createdBy: staff._id,
                assignedTo: staff._id,
                placementLocation: 'Test Shelter',
                rescueStatus: 'placed',
                ...overrides
            });
        }
        httpServer = await new Promise((resolve) => {
            const server = app.listen(0, '127.0.0.1', () => resolve(server));
        });
        const base = 'http://127.0.0.1:' + httpServer.address().port;
        const clients = Object.fromEntries(
            ['staff', 'colleague', 'admin', 'anonymous'].map((role) => [
                role,
                {
                    cookie: '',
                    csrf: ''
                }
            ])
        );
        async function request(method, url, body, role = 'staff', options = {}) {
            const client = clients[role];
            const headers = {};
            if (client.cookie) headers.Cookie = client.cookie;
            if (client.csrf && !options.noCsrf) headers['X-CSRF-Token'] = client.csrf;
            let payload;
            if (body !== undefined) {
                headers['Content-Type'] = options.form
                    ? 'application/x-www-form-urlencoded'
                    : 'application/json';
                payload = options.form
                    ? new URLSearchParams(body).toString()
                    : JSON.stringify(body);
            }
            const response = await fetch(base + url, {
                method,
                headers,
                body: payload,
                redirect: 'manual'
            });
            const setCookies = response.headers.getSetCookie();
            if (setCookies.length)
                client.cookie = setCookies.map((value) => value.split(';')[0]).join('; ');
            if (response.headers.get('x-csrf-token'))
                client.csrf = response.headers.get('x-csrf-token');
            const text = await response.text();
            return {
                status: response.status,
                text,
                json: response.headers.get('content-type')?.includes('json')
                    ? JSON.parse(text)
                    : null,
                location: response.headers.get('location')
            };
        }
        for (const [role, user] of Object.entries({ staff, colleague, admin })) {
            const token = await request('GET', '/api/csrf', undefined, role);
            assert.equal(token.status, 200);
            clients[role].csrf = token.json.data.csrfToken;
            const login = await request('POST', '/api/login', {
                username: user.username, password
            }, role);
            assert.equal(login.status, 200);
            clients[role].csrf = '';
        }
        const a = await animal();
        const id = String(a._id);
        const api = '/api/animals/' + id;
        assert.equal(
            (await request('GET', api + '/adoption', undefined, 'anonymous')).status,
            401
        );
        assert.equal(
            (await request('GET', '/animals/' + id + '/adoption', undefined, 'anonymous'))
                .location,
            '/login'
        );
        passed('Unauthenticated API requests rejected and web requests redirected');
        const realResponse = await fetch(
            base + api + '/adoption',
            {
                headers: {
                    'X-Test-User': String(admin._id)
                }
            }
        );
        assert.equal(realResponse.status, 401);
        await realResponse.text();
        passed('Production application rejects injected test identities');
        assert.equal((await request('GET', api + '/adoption')).json.data.adoption, null);
        assert.ok(clients.staff.csrf);
        assert.equal(
            (
                await request(
                    'PUT',
                    api + '/adoption-status',
                    {
                        adoptionStatus: 'available',
                        healthConfirmed: true
                    },
                    'staff',
                    {
                        noCsrf: true
                    }
                )
            ).status,
            403
        );
        assert.equal((await Animal.findById(id)).adoptionStatus, 'not_open');
        passed('Read requests issue CSRF tokens and missing tokens cannot mutate data');
        assert.equal((await request('GET', '/api/animals/bad/adoption')).status, 400);
        assert.equal(
            (
                await request(
                    'GET',
                    '/api/animals/' + new mongoose.Types.ObjectId() + '/adoption'
                )
            ).status,
            404
        );
        passed('Invalid and missing IDs return 400 and 404');
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'available'
                })
            ).status,
            400
        );
        for (const role of ['admin', 'colleague']) {
            const token = await request('GET', '/api/csrf', undefined, role);
            clients[role].csrf = token.json.data.csrfToken;
        }
        await require('./scripts/test-case-permissions')({
            request, animal, Animal, staff, colleague, admin, passed
        });
        const pending = await animal({
            rescueStatus: 'pending',
            assignedTo: null,
            placementLocation: ''
        });
        assert.equal(
            (
                await request('PUT', '/api/animals/' + pending._id + '/adoption-status', {
                    adoptionStatus: 'available',
                    healthConfirmed: true
                }, 'admin')
            ).status,
            409
        );
        const incomplete = await animal({
            assignedTo: null
        });
        assert.equal(
            (
                await request(
                    'PUT',
                    '/api/animals/' + incomplete._id + '/adoption-status',
                    {
                        adoptionStatus: 'available',
                        healthConfirmed: true
                    }, 'admin'
                )
            ).status,
            409
        );
        passed('Opening adoption requires placement, assignment and health confirmation');
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'available',
                    healthConfirmed: true
                })
            ).status,
            200
        );
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'not_open'
                })
            ).status,
            200
        );
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'available',
                    healthConfirmed: true
                })
            ).status,
            200
        );
        passed('Adoption availability can be opened and withdrawn');
        for (const body of [
            {
                adopterName: 'First'
            },
            {
                adopterName: {},
                adopterPhone: '0'
            },
            {
                adopterName: 'a'.repeat(81),
                adopterPhone: '0'
            },
            {
                adopterName: 'First',
                adopterPhone: '0',
                remarks: 'a'.repeat(2001)
            }
        ]) {
            assert.equal((await request('POST', api + '/adoption', body)).status, 400);
        }
        assert.equal(
            await Adoption.countDocuments({
                animalId: id
            }),
            0
        );
        assert.equal(
            (
                await request('PUT', api + '/close', {
                    confirm: true
                })
            ).status,
            409
        );
        passed('Invalid and oversized fields rejected; unregistered adoption cannot close');
        const registration = {
            adopterName: ' <script>alert(1)</script> ',
            adopterPhone: '00000123',
            remarks: ' Test notes ',
            registeredBy: admin._id,
            completedAt: new Date()
        };
        const races = await Promise.all([
            request('POST', api + '/adoption', registration),
            request('POST', api + '/adoption', registration)
        ]);
        assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
        const saved = await Adoption.findOne({
            animalId: id
        });
        const firstStamp = {
            adoptionId: String(saved._id),
            adoptionVersion: saved.__v || 0
        };
        assert.equal(
            await Adoption.countDocuments({
                animalId: id
            }),
            1
        );
        assert.equal(String(saved.registeredBy), String(staff._id));
        assert.equal(saved.completedAt, null);
        assert.equal(saved.adopterPhone, '+85200000123');
        assert.equal(saved.remarks, 'Test notes');
        assert.equal((await Animal.findById(id)).adoptionStatus, 'processing');
        passed('Concurrent registration succeeds once and preserves trusted authorship');
        const html = await request('GET', '/animals/' + id + '/adoption');
        assert.equal(html.status, 200);
        assert.ok(html.text.includes('href="/adoption-management"'));
        assert.ok(html.text.includes('&lt;script&gt;'));
        assert.ok(!html.text.includes('<script>alert(1)</script>'));
        passed('Adoption page escapes user content');
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'not_open'
                })
            ).status,
            409
        );
        assert.equal((await request('PUT', api + '/close', {})).status, 400);
        const closeRaces = await Promise.all([
            request('PUT', api + '/close', {
                ...firstStamp,
                confirm: true
            }),
            request('PUT', api + '/close', {
                ...firstStamp,
                confirm: true
            })
        ]);
        assert.deepEqual(closeRaces.map((r) => r.status).sort(), [200, 409]);
        const closed = await Animal.findById(id);
        const completed = await Adoption.findOne({
            animalId: id
        });
        assert.equal(closed.adoptionStatus, 'adopted');
        assert.equal(String(closed.closedBy), String(staff._id));
        assert.equal(closed.closedAt.toISOString(), completed.completedAt.toISOString());
        assert.equal(
            (
                await request('PUT', api + '/adoption-status', {
                    adoptionStatus: 'available',
                    healthConfirmed: true
                })
            ).status,
            409
        );
        assert.equal((await request('POST', api + '/adoption', registration)).status, 409);
        assert.equal(
            (await Animal.findById(id)).closedAt.toISOString(),
            closed.closedAt.toISOString()
        );
        passed('Concurrent closure succeeds once and preserves consistent timestamps');
        const closedPage = await request('GET', '/animals/' + id + '/close');
        assert.equal(closedPage.status, 200);
        assert.ok(!closedPage.text.includes('name="confirm"'));
        assert.equal((await request('GET', '/animals/' + id + '/delete')).status, 403);
        assert.equal(
            (
                await request('DELETE', api, {
                    confirm: true,
                    deletionReason: 'Incorrect record'
                })
            ).status,
            403
        );
        await request('GET', api + '/adoption', undefined, 'admin');
        assert.equal(
            (
                await request(
                    'DELETE',
                    api,
                    {
                        confirm: true,
                        deletionReason: 'Incorrect record'
                    },
                    'admin'
                )
            ).status,
            409
        );
        assert.equal(
            (await request('GET', '/animals/' + id + '/delete', undefined, 'admin')).status,
            409
        );
        passed('Closed cases are read-only for administrators too');
        const victim = await animal({
            adoptionStatus: 'available'
        });
        const vid = String(victim._id);
        const vapi = '/api/animals/' + vid;
        await request('POST', vapi + '/adoption', registration);
        const follow = await FollowUp.create({
            animalId: vid,
            content: 'Test follow-up',
            recordedBy: staff._id
        });
        const originalDelete = Adoption.deleteMany;
        Adoption.deleteMany = async function () {
            throw new Error('INJECTED_AFTER_FOLLOWUP_DELETE');
        };
        try {
            assert.equal(
                (
                    await request(
                        'DELETE',
                        vapi,
                        {
                            confirm: true,
                            deletionReason: 'Duplicate'
                        },
                        'admin'
                    )
                ).status,
                500
            );
        } finally {
            Adoption.deleteMany = originalDelete;
        }
        assert.ok(
            await Animal.exists({
                _id: vid
            })
        );
        assert.ok(
            await FollowUp.exists({
                _id: follow._id
            })
        );
        assert.ok(
            await Adoption.exists({
                animalId: vid
            })
        );
        assert.equal(
            await DeletionLog.countDocuments({
                animalId: vid
            }),
            0
        );
        passed('Failed associated deletion rolls back all records');
        const deleted = await request(
            'DELETE',
            vapi,
            {
                confirm: true,
                deletionReason: 'Duplicate'
            },
            'admin'
        );
        assert.equal(deleted.status, 200);
        assert.equal(deleted.json.data.deletedFollowUps, 1);
        assert.equal(
            await Animal.countDocuments({
                _id: vid
            }),
            0
        );
        assert.equal(
            await FollowUp.countDocuments({
                animalId: vid
            }),
            0
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: vid
            }),
            0
        );
        assert.equal(
            (
                await request(
                    'DELETE',
                    vapi,
                    {
                        confirm: true,
                        deletionReason: 'Duplicate'
                    },
                    'admin'
                )
            ).status,
            404
        );
        assert.equal(
            await DeletionLog.countDocuments({
                animalId: vid
            }),
            1
        );
        passed('Administrator deletion retains an independent audit trail');
        const b = await animal({
            adoptionStatus: 'available'
        });
        const bid = String(b._id);
        const originalSave = Animal.prototype.save;
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === bid && this.adoptionStatus === 'processing')
                throw new Error('INJECTED_AFTER_ADOPTION_CREATE');
            return originalSave.apply(this, args);
        };
        try {
            assert.equal(
                (await request('POST', '/api/animals/' + bid + '/adoption', registration))
                    .status,
                500
            );
        } finally {
            Animal.prototype.save = originalSave;
        }
        assert.equal(
            await Adoption.countDocuments({
                animalId: bid
            }),
            0
        );
        assert.equal((await Animal.findById(bid)).adoptionStatus, 'available');
        passed('Failed registration rolls back adoption and animal status');
        const formError = await request(
            'POST',
            '/animals/' + bid + '/adoption',
            {
                adopterName: 'Preserved Name',
                adopterPhone: ''
            },
            'staff',
            {
                form: true
            }
        );
        assert.equal(formError.status, 400);
        assert.ok(formError.text.includes('value="Preserved Name"'));
        const formOk = await request(
            'POST',
            '/animals/' + bid + '/adoption',
            {
                adopterName: 'Test Adopter',
                adopterPhone: '00000000',
                remarks: 'Web form'
            },
            'staff',
            {
                form: true
            }
        );
        assert.equal(formOk.status, 303);
        const destination = new URL(formOk.location, base);
        assert.equal(destination.pathname, '/adoption-management');
        assert.equal(destination.searchParams.get('tab'), 'processing');
        const registeredPage = await request('GET', formOk.location);
        assert.equal(registeredPage.status, 200);
        const bAdoption = await Adoption.findOne({
            animalId: bid
        });
        assert.equal(destination.hash, '#record-' + bAdoption._id);
        assert.ok(registeredPage.text.includes('id="record-' + bAdoption._id + '"'));
        const bStamp = {
            adoptionId: String(bAdoption._id),
            adoptionVersion: bAdoption.__v || 0
        };
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === bid && this.adoptionStatus === 'adopted')
                throw new Error('INJECTED_AFTER_COMPLETION');
            return originalSave.apply(this, args);
        };
        try {
            assert.equal(
                (
                    await request('PUT', '/api/animals/' + bid + '/close', {
                        ...bStamp,
                        confirm: true
                    })
                ).status,
                500
            );
        } finally {
            Animal.prototype.save = originalSave;
        }
        assert.equal(
            (
                await Adoption.findOne({
                    animalId: bid
                })
            ).completedAt,
            null
        );
        assert.equal((await Animal.findById(bid)).adoptionStatus, 'processing');
        passed('Web validation preserves input; failed closure rolls back');
        const c = await animal({
            adoptionStatus: 'available'
        });
        await request('GET', '/api/animals/' + c._id + '/adoption', undefined, 'admin');
        const deleteRace = await Promise.all([
            request('POST', '/api/animals/' + c._id + '/adoption', registration),
            request(
                'DELETE',
                '/api/animals/' + c._id,
                {
                    confirm: true,
                    deletionReason: 'Concurrency test'
                },
                'admin'
            )
        ]);
        assert.equal(deleteRace[1].status, 200);
        assert.ok([201, 404].includes(deleteRace[0].status));
        assert.equal(
            await Animal.countDocuments({
                _id: c._id
            }),
            0
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: c._id
            }),
            0
        );
        passed('Concurrent registration and deletion leave no orphan records');
        await User.updateOne(
            {
                _id: admin._id
            },
            {
                role: 'staff'
            }
        );
        assert.equal(
            (
                await request(
                    'DELETE',
                    '/api/animals/' + bid,
                    {
                        confirm: true
                    },
                    'admin'
                )
            ).status,
            403
        );
        await User.updateOne(
            {
                _id: admin._id
            },
            {
                role: 'admin'
            }
        );
        passed('Revoked administrator privileges immediately prevent deletion');
        const cform = await request(
            'POST',
            '/animals/' + bid + '/close',
            {
                ...bStamp,
                confirm: 'yes'
            },
            'staff',
            {
                form: true
            }
        );
        assert.equal(cform.status, 303);
        assert.equal((await request('GET', cform.location)).status, 200);
        const d = await animal();
        const dform = await request(
            'POST',
            '/animals/' + d._id + '/delete',
            {
                confirm: 'yes',
                deletionReason: 'Web test record'
            },
            'admin',
            {
                form: true
            }
        );
        assert.equal(dform.status, 303);
        assert.equal(
            (await request('GET', dform.location, undefined, 'admin')).status,
            200
        );
        passed('Web closure and deletion redirect to readable results');
        async function stampFor(animalId) {
            const row = await Adoption.findOne({
                animalId,
                cancelledAt: null
            });
            return {
                adoptionId: String(row._id),
                adoptionVersion: row.__v || 0
            };
        }

        const legacyAnimal = await animal({
            adoptionStatus: 'processing'
        });
        const legacy = await Adoption.collection.insertOne({
            animalId: legacyAnimal._id,
            adopterName: 'Legacy registration',
            adopterPhone: '00000',
            registeredBy: staff._id,
            completedAt: null,
            __v: 0
        });
        await Adoption.collection.createIndex(
            {
                animalId: 1
            },
            {
                name: 'animalId_1',
                unique: true
            }
        );
        await Adoption.collection.createIndex(
            {
                adopterName: 1
            },
            {
                name: 'keep_unrelated_index'
            }
        );
        await nPrepareDatabase();
        await nPrepareDatabase();
        const indexes = await Adoption.collection.indexes();
        assert.ok(!indexes.some((x) => x.name === 'animalId_1'));
        assert.ok(indexes.some((x) => x.name === 'one_current_adoption' && x.unique));
        assert.ok(indexes.some((x) => x.name === 'keep_unrelated_index'));
        assert.ok(
            await Adoption.collection.findOne({
                _id: legacy.insertedId
            })
        );
        assert.equal(
            (await request('GET', '/api/animals/' + legacyAnimal._id + '/adoption')).json
                .data.adoption.adopterName,
            'Legacy registration'
        );
        await assert.rejects(
            () =>
                Adoption.create({
                    animalId: legacyAnimal._id,
                    adopterName: 'Duplicate',
                    adopterPhone: '0',
                    registeredBy: staff._id
                }),
            (e) => e.code === 11000
        );
        passed(
            'Legacy index migration is safe, idempotent and preserves unrelated indexes'
        );

        const e = await animal({
            adoptionStatus: 'available'
        });
        const eid = String(e._id);
        const eapi = '/api/animals/' + eid;
        await request('POST', eapi + '/adoption', registration);
        let est = await stampFor(eid);
        const originalRegistration = await Adoption.findById(est.adoptionId);
        const changed = {
            ...est,
            adopterName: 'Updated Name',
            adopterPhone: '00000999',
            remarks: '<script>Notes</script>',
            updatedBy: admin._id
        };
        assert.equal((await request('PUT', eapi + '/adoption', changed)).status, 200);
        assert.equal((await Adoption.findById(est.adoptionId)).adopterName, 'Updated Name');
        assert.equal(
            String((await Adoption.findById(est.adoptionId)).updatedBy),
            String(staff._id)
        );
        assert.equal(
            String((await Adoption.findById(est.adoptionId)).registeredBy),
            String(originalRegistration.registeredBy)
        );
        assert.equal((await request('PUT', eapi + '/adoption', changed)).status, 409);
        assert.equal(
            (
                await request('PUT', eapi + '/close', {
                    ...est,
                    confirm: true
                })
            ).status,
            409
        );
        est = await stampFor(eid);
        assert.equal(
            (
                await request('PUT', eapi + '/adoption', {
                    ...changed,
                    ...est,
                    adoptionVersion: {}
                })
            ).status,
            400
        );
        const concurrentEdits = await Promise.all([
            request('PUT', eapi + '/adoption', {
                ...changed,
                ...est,
                adopterName: 'First'
            }),
            request('PUT', eapi + '/adoption', {
                ...changed,
                ...est,
                adopterName: 'Second'
            })
        ]);
        assert.deepEqual(concurrentEdits.map((x) => x.status).sort(), [200, 409]);
        passed('Adoption editing verifies versions and trusted authorship');
        est = await stampFor(eid);
        for (const cancellationReason of ['', '  ', {}, 'a'.repeat(1001)]) {
            assert.equal(
                (
                    await request('PUT', eapi + '/adoption/cancel', {
                        ...est,
                        confirm: true,
                        cancellationReason
                    })
                ).status,
                400
            );
        }
        assert.equal(
            (
                await request('PUT', eapi + '/adoption/cancel', {
                    ...est,
                    cancellationReason: 'Withdrew'
                })
            ).status,
            400
        );
        assert.equal(
            (
                await request(
                    'PUT',
                    eapi + '/adoption/cancel',
                    {
                        ...est,
                        confirm: true,
                        cancellationReason: 'Withdrew'
                    },
                    'staff',
                    {
                        noCsrf: true
                    }
                )
            ).status,
            403
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption/cancel', {
                    ...est,
                    adoptionId: String(legacy.insertedId),
                    confirm: true,
                    cancellationReason: 'Withdrew'
                })
            ).status,
            409
        );
        passed('Cancellation requires reason, confirmation, CSRF and matching adoption ID');

        const saveBeforeCancel = Animal.prototype.save;
        Animal.prototype.save = async function (...args) {
            if (String(this._id) === eid && this.adoptionStatus === 'available')
                throw new Error('INJECTED_CANCEL_FAILURE');
            return saveBeforeCancel.apply(this, args);
        };
        try {
            assert.equal(
                (
                    await request('PUT', eapi + '/adoption/cancel', {
                        ...est,
                        confirm: true,
                        cancellationReason: 'Injected failure'
                    })
                ).status,
                500
            );
        } finally {
            Animal.prototype.save = saveBeforeCancel;
        }
        assert.equal((await Adoption.findById(est.adoptionId)).cancelledAt, null);
        assert.equal((await Animal.findById(eid)).adoptionStatus, 'processing');
        assert.deepEqual(await stampFor(eid), est);
        passed('Failed cancellation rolls back status, history and version');
        const cancelBody = {
            ...est,
            confirm: true,
            cancellationReason: 'Adopter withdrew',
            cancelledBy: admin._id
        };
        assert.equal(
            (await request('PUT', eapi + '/adoption/cancel', cancelBody)).status,
            200
        );
        const historyRow = await Adoption.findById(est.adoptionId);
        assert.equal(historyRow.cancellationReason, 'Adopter withdrew');
        assert.equal(String(historyRow.cancelledBy), String(staff._id));
        assert.ok(historyRow.cancelledAt);
        assert.equal((await Animal.findById(eid)).adoptionStatus, 'available');
        const afterCancel = (await request('GET', eapi + '/adoption')).json.data;
        assert.equal(afterCancel.adoption, null);
        assert.equal(afterCancel.adoptionHistory.length, 1);
        assert.equal(
            (await request('PUT', eapi + '/adoption/cancel', cancelBody)).status,
            409
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption-status', {
                    adoptionStatus: 'not_open'
                })
            ).status,
            200
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption-status', {
                    adoptionStatus: 'available',
                    healthConfirmed: true
                })
            ).status,
            200
        );
        const reregister = await Promise.all([
            request('POST', eapi + '/adoption', registration),
            request('POST', eapi + '/adoption', registration)
        ]);
        assert.deepEqual(reregister.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
            await Adoption.countDocuments({
                animalId: eid
            }),
            2
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: eid,
                cancelledAt: null
            }),
            1
        );
        assert.equal(
            (await request('PUT', eapi + '/adoption/cancel', cancelBody)).status,
            409
        );
        assert.equal(
            (
                await request('PUT', eapi + '/close', {
                    ...est,
                    confirm: true
                })
            ).status,
            409
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption', {
                    ...registration,
                    ...est
                })
            ).status,
            409
        );
        assert.equal(
            (await Adoption.findById(est.adoptionId)).cancellationReason,
            'Adopter withdrew'
        );
        const historyPage = await request('GET', '/animals/' + eid + '/adoption');
        assert.ok(historyPage.text.includes('Cancelled Adoptions'));
        assert.ok(historyPage.text.includes('Adopter withdrew'));
        passed(
            'Cancelled history survives registration; stale forms cannot change new adoption'
        );

        let currentStamp = await stampFor(eid);
        const badEdit = await request(
            'POST',
            '/animals/' + eid + '/adoption/edit',
            {
                ...currentStamp,
                adopterName: 'Preserved edit',
                adopterPhone: ''
            },
            'staff',
            {
                form: true
            }
        );
        assert.equal(badEdit.status, 400);
        assert.ok(badEdit.text.includes('value="Preserved edit"'));
        assert.equal(
            (
                await request(
                    'POST',
                    '/animals/' + eid + '/adoption/edit',
                    {
                        ...registration,
                        ...currentStamp
                    },
                    'staff',
                    {
                        form: true
                    }
                )
            ).status,
            303
        );
        const staleForm = await request(
            'POST',
            '/animals/' + eid + '/adoption/edit',
            {
                ...registration,
                ...currentStamp
            },
            'staff',
            {
                form: true
            }
        );
        assert.equal(staleForm.status, 409);
        assert.match(staleForm.text, /Reload\s+and\s+Review\s*<\/a>/);
        assert.ok(staleForm.text.includes('disabled'));
        currentStamp = await stampFor(eid);
        assert.equal(
            (
                await request(
                    'POST',
                    '/animals/' + eid + '/adoption/cancel',
                    {
                        ...currentStamp,
                        confirm: 'yes',
                        cancellationReason: 'Web cancellation'
                    },
                    'staff',
                    {
                        form: true
                    }
                )
            ).status,
            303
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: eid,
                cancelledAt: {
                    $ne: null
                }
            }),
            2
        );
        passed('Web editing preserves fields and blocks repeated stale submissions');

        await request('POST', eapi + '/adoption', registration);
        currentStamp = await stampFor(eid);
        const cancelledSnapshot = await Adoption.find({
            animalId: eid,
            cancelledAt: {
                $ne: null
            }
        })
            .sort({
                _id: 1
            })
            .lean();
        assert.equal(
            (
                await request('PUT', eapi + '/close', {
                    ...currentStamp,
                    confirm: true
                })
            ).status,
            200
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption', {
                    ...registration,
                    ...currentStamp
                })
            ).status,
            409
        );
        assert.equal(
            (
                await request('PUT', eapi + '/adoption/cancel', {
                    ...currentStamp,
                    confirm: true,
                    cancellationReason: 'Not allowed'
                })
            ).status,
            409
        );
        assert.equal(
            (
                await request(
                    'DELETE',
                    eapi,
                    {
                        confirm: true,
                        deletionReason: 'Not allowed'
                    },
                    'admin'
                )
            ).status,
            409
        );
        assert.equal(
            (await request('GET', '/animals/' + eid + '/delete', undefined, 'admin'))
                .status,
            409
        );
        assert.deepEqual(
            await Adoption.find({
                animalId: eid,
                cancelledAt: {
                    $ne: null
                }
            })
                .sort({
                    _id: 1
                })
                .lean(),
            cancelledSnapshot
        );
        const closedAdoptionPage = await request(
            'GET',
            '/animals/' + eid + '/adoption',
            undefined,
            'admin'
        );
        assert.doesNotMatch(closedAdoptionPage.text, /Delete\s+Incorrect\s+Record/);
        assert.ok(
            !closedAdoptionPage.text.includes('action="/animals/' + eid + '/adoption/edit"')
        );
        passed('Closed cases reject all writes and preserve cancellation history');

        const f = await animal({
            adoptionStatus: 'available'
        });
        const fid = String(f._id);
        const fapi = '/api/animals/' + fid;
        await request('POST', fapi + '/adoption', registration);
        const fst = await stampFor(fid);
        const finishRace = await Promise.all([
            request('PUT', fapi + '/adoption/cancel', {
                ...fst,
                confirm: true,
                cancellationReason: 'Cancellation race'
            }),
            request('PUT', fapi + '/close', {
                ...fst,
                confirm: true
            })
        ]);
        assert.deepEqual(finishRace.map((x) => x.status).sort(), [200, 409]);
        const fAnimal = await Animal.findById(fid),
            fAdoption = await Adoption.findById(fst.adoptionId);
        if (fAdoption.cancelledAt) {
            assert.equal(fAnimal.adoptionStatus, 'available');
            assert.equal(fAnimal.closedAt, null);
            assert.equal(fAdoption.completedAt, null);
        } else {
            assert.equal(fAnimal.adoptionStatus, 'adopted');
            assert.ok(fAnimal.closedAt);
            assert.ok(fAdoption.completedAt);
        }
        passed('Concurrent cancellation and closure cannot produce contradictory states');

        const g = await animal({
            adoptionStatus: 'available'
        });
        const gid = String(g._id);
        const gapi = '/api/animals/' + gid;
        await request('POST', gapi + '/adoption', registration);
        await request('PUT', gapi + '/adoption/cancel', {
            ...(await stampFor(gid)),
            confirm: true,
            cancellationReason: 'Preserve history'
        });
        await request('POST', gapi + '/adoption', registration);
        await FollowUp.create({
            animalId: gid,
            content: 'Delete with animal',
            recordedBy: staff._id
        });
        await request('GET', gapi + '/adoption', undefined, 'admin');
        for (const deletionReason of ['', '  ', {}, 'x'.repeat(1001)])
            assert.equal(
                (
                    await request(
                        'DELETE',
                        gapi,
                        {
                            confirm: true,
                            deletionReason
                        },
                        'admin'
                    )
                ).status,
                400
            );
        assert.equal(
            await DeletionLog.countDocuments({
                animalId: gid
            }),
            0
        );
        const logCreate = DeletionLog.create;
        DeletionLog.create = async () => {
            throw new Error('INJECTED_AUDIT_FAILURE');
        };
        try {
            assert.equal(
                (
                    await request(
                        'DELETE',
                        gapi,
                        {
                            confirm: true,
                            deletionReason: 'Duplicate record'
                        },
                        'admin'
                    )
                ).status,
                500
            );
        } finally {
            DeletionLog.create = logCreate;
        }
        assert.ok(
            await Animal.exists({
                _id: gid
            })
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: gid
            }),
            2
        );
        assert.equal(
            await FollowUp.countDocuments({
                animalId: gid
            }),
            1
        );
        const animalDelete = Animal.deleteOne;
        Animal.deleteOne = async () => {
            throw new Error('INJECTED_AFTER_AUDIT_CREATE');
        };
        try {
            assert.equal(
                (
                    await request(
                        'DELETE',
                        gapi,
                        {
                            confirm: true,
                            deletionReason: 'Duplicate record'
                        },
                        'admin'
                    )
                ).status,
                500
            );
        } finally {
            Animal.deleteOne = animalDelete;
        }
        assert.equal(
            await DeletionLog.countDocuments({
                animalId: gid
            }),
            0
        );
        assert.ok(
            await Animal.exists({
                _id: gid
            })
        );
        assert.equal(
            await Adoption.countDocuments({
                animalId: gid
            }),
            2
        );
        const deletion = await request(
            'DELETE',
            gapi,
            {
                confirm: true,
                deletionReason: 'Duplicate record',
                deletedBy: staff._id,
                animalCode: 'Forged code'
            },
            'admin'
        );
        assert.equal(deletion.status, 200);
        assert.equal(deletion.json.data.deletedAdoptions, 2);
        const audit = await DeletionLog.findOne({
            animalId: gid
        });
        assert.equal(audit.animalCode, g.animalCode);
        assert.equal(String(audit.deletedBy), String(admin._id));
        assert.equal(audit.reason, 'Duplicate record');
        assert.ok(audit.deletedAt);
        assert.equal(audit.deletedFollowUps, 1);
        assert.equal(audit.deletedAdoptions, 2);
        assert.equal(
            await Adoption.countDocuments({
                animalId: gid
            }),
            0
        );
        assert.equal(
            await FollowUp.countDocuments({
                animalId: gid
            }),
            0
        );
        assert.equal(
            (
                await request(
                    'DELETE',
                    gapi,
                    {
                        confirm: true,
                        deletionReason: 'Delete again'
                    },
                    'admin'
                )
            ).status,
            404
        );
        assert.equal(
            await DeletionLog.countDocuments({
                animalId: gid
            }),
            1
        );
        passed('Associated deletion and audit creation roll back together');

        const lookupCode = 'AR-2026-10005';
        const target = await animal({ animalCode: lookupCode, appearance: 'Exact lookup match' });
        const decoy = await animal({ animalCode: lookupCode + '0', appearance: lookupCode });
        for (const record of [target, decoy]) {
            await FollowUp.create({ animalId: record._id, content: record.appearance, recordedBy: staff._id });
            await Adoption.create({ animalId: record._id, adopterName: 'Test adopter',
                adopterPhone: '12345678', registeredBy: staff._id });
        }
        for (const path of ['/rescue-management?tab=active', '/followup-records?tab=all',
            '/adoption-management?tab=processing']) {
            const exact = await request('GET', path + '&q=%20ar-2026-10005%20');
            assert.equal(exact.status, 200);
            assert.ok(exact.text.includes('/animals/' + target._id));
            assert.ok(!exact.text.includes('/animals/' + decoy._id));
            for (const input of ['1', '2', 'AR-2026-', 'Exact']) {
                const partial = await request('GET', path + '&q=' + input);
                assert.equal(partial.status, 200);
                assert.ok(partial.text.includes('Enter the full animal code'));
                assert.ok(!partial.text.includes('/animals/' + target._id));
                assert.ok(!partial.text.includes('/animals/' + decoy._id));
            }
        }
        passed('Workspace searches require an exact animal code, including for related records');

        await User.updateOne(
            {
                _id: staff._id
            },
            {
                isActive: false
            }
        );
        assert.equal((await request('GET', eapi + '/adoption')).status, 401);
        assert.equal(
            (
                await request('PUT', eapi + '/adoption/cancel', {
                    ...currentStamp,
                    confirm: true,
                    cancellationReason: 'Not allowed'
                })
            ).status,
            401
        );
        assert.equal(
            (await request('GET', '/animals/' + eid + '/adoption')).location,
            '/login'
        );
        assert.ok(
            await Animal.exists({
                createdBy: staff._id
            })
        );
        assert.ok(
            await Adoption.exists({
                registeredBy: staff._id
            })
        );
        await User.updateOne(
            {
                _id: staff._id
            },
            {
                isActive: true
            }
        );
        await request('GET', eapi + '/adoption');
        passed('Disabled accounts lose access without losing historical references');

        if (process.env.N_TEST_HTML_DIR) {
            const folder = process.env.N_TEST_HTML_DIR;
            fs.mkdirSync(folder, {
                recursive: true
            });
            for (const state of ['not_open', 'available', 'processing', 'adopted']) {
                const sample = await animal({
                    adoptionStatus: state,
                    ...(state === 'adopted'
                        ? {
                              closedAt: new Date(),
                              closedBy: staff._id
                          }
                        : {})
                });
                if (['processing', 'adopted'].includes(state))
                    await Adoption.create({
                        animalId: sample._id,
                        adopterName: 'Test Adopter',
                        adopterPhone: '00000000',
                        registeredBy: staff._id,
                        completedAt: state === 'adopted' ? sample.closedAt : null
                    });
                for (const view of ['adoption', 'close', 'delete']) {
                    const page = await request(
                        'GET',
                        '/animals/' + sample._id + '/' + view,
                        undefined,
                        'admin'
                    );
                    assert.equal(
                        page.status,
                        state === 'adopted' && view === 'delete' ? 409 : 200
                    );
                    fs.writeFileSync(
                        path.join(folder, state + '-' + view + '.html'),
                        page.text.replace('href="/style.css"', 'href="style.css"')
                    );
                }
            }
            fs.copyFileSync(
                path.join(__dirname, 'public/style.css'),
                path.join(folder, 'style.css')
            );
        }
        console.log(
            'N integration tests passed: ' +
                count +
                ' groups; isolated database: ' +
                databaseName
        );
    } finally {
        if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
        if (
            mongoose.connection.readyState === 1 &&
            mongoose.connection.name === databaseName &&
            /^group007_n_test_[a-f0-9]{20}$/.test(databaseName)
        )
            await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
}

// ============================================================================

// ============================================================================

// 99 Shared error handling and server startup
app.use((req, res) => {
    if (isApiRequest(req))
        return sendApiError(res, 404, 'NOT_FOUND', 'API endpoint not found.');
    return res.status(404).render('info', {
        title: 'Page Not Found',
        activePage: '',
        message: 'This page does not exist. Return to the dashboard or animal list.'
    });
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'The server could not complete the request. Please try again.';
    if (error.type === 'entity.parse.failed') {
        status = 400;
        code = 'INVALID_BODY';
        message = 'Invalid request body.';
    } else if (error.status === 413) {
        status = 413;
        code = 'BODY_TOO_LARGE';
        message = 'Request body is too large.';
    }
    if (status === 500) console.error('Request failed: ', error.message);
    if (isApiRequest(req)) return sendApiError(res, status, code, message);
    return res.status(status).render('info', {
        title: 'Request Failed',
        activePage: '',
        message
    });
});

async function startServer() {
    try {
        if (process.env.CONNECT_DB === '1') {
            const uri = process.env.MONGODB_URI ||
                'mongodb://127.0.0.1:27017/animal_rescue_group007';
            const dbName = applicationDatabaseName(uri);
            await mongoose.connect(uri, {
                dbName,
                serverSelectionTimeoutMS: 5000
            });
            await nPrepareDatabase();
            console.log('MongoDB connected; database: ' + mongoose.connection.name + '; database indexes ready');
        }

        const port = process.env.PORT || 8099;
        const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');

        const server = app.listen(port, host, () => {
            console.log(`Application URL: http://${host}:${port}`);
        });

        server.on('error', (error) => {
            console.error('Startup failed: ', error.message);
            process.exit(1);
        });
    } catch (error) {
        console.error('Startup failed: ', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    if (process.argv.includes('--create-admin')) {
        createAdministrator().catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        });
    } else if (process.argv.includes('--test-n')) {
        nRunIntegrationTests().catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
    } else {
        startServer();
    }
}

module.exports = app;

module.exports.nModule = {
    registerRoutes: nRegisterRoutes,
    prepareDatabase: nPrepareDatabase,
    withAnimalTransaction: nTransaction
};
