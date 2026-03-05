require('dotenv').config(); // Must be first so env vars are available everywhere.

const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { logInfo, logError } = require('./utils/logger');

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

// --- PAYMENT CONFIG ---
const PAYMENT_CONFIG_PATH = path.join(__dirname, '..', 'payment-config.json');

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toStringArray(value, fallback = []) {
    if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
    return fallback;
}

function loadPaymentConfig() {
    if (!fs.existsSync(PAYMENT_CONFIG_PATH)) {
        throw new Error(`Missing payment config file: ${PAYMENT_CONFIG_PATH}`);
    }

    const raw = fs.readFileSync(PAYMENT_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.products) || parsed.products.length === 0) {
        throw new Error('payment-config.json must include a non-empty "products" array');
    }

    for (const p of parsed.products) {
        if (!p.id || !p.name) {
            throw new Error('Each product in payment-config.json requires "id" and "name"');
        }
        if (!Number.isFinite(Number(p.amount_inr)) || Number(p.amount_inr) <= 0) {
            throw new Error(`Product "${p.id}" has invalid amount_inr`);
        }
    }

    return parsed;
}

const paymentConfig = loadPaymentConfig();
const productsById = new Map(paymentConfig.products.map((product) => [product.id, product]));

function getProductOrThrow(productId) {
    const product = productsById.get(productId);
    if (!product) throw new Error(`Unknown product id: ${productId}`);
    return product;
}

function getLiteLlmPlanConfig(product) {
    const defaults = paymentConfig.litellm?.defaults || {};
    const plan = product.litellm || {};
    const keyBudgetFallback = toNumber(product.credits_minutes, 0);

    return {
        key_budget: toNumber(plan.key_budget, toNumber(defaults.key_budget, keyBudgetFallback)),
        key_metadata_available_budget: toNumber(
            plan.key_metadata_available_budget,
            toNumber(defaults.key_metadata_available_budget, keyBudgetFallback)
        ),
        team_id: String(plan.team_id || defaults.team_id || 'default').trim(),
        models: toStringArray(plan.models, toStringArray(defaults.models, [])),
        key_type: String(plan.key_type || defaults.key_type || 'llm_api').trim(),
        metadata: {
            ...(defaults.metadata || {}),
            ...(plan.metadata || {})
        }
    };
}

function getPrimaryCustomerMetadataField() {
    return String(paymentConfig.litellm?.metadata_customer_id_field || 'payment_customer_id').trim();
}

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (includes /downloads/ for generated plugin zips)
app.use(express.static(path.join(__dirname, 'public')));

// --- MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: isDev ? false : {
        directives: {
            'default-src': ["'self'"],
            'script-src': [
                "'self'",
                "'unsafe-inline'",
                'https://checkout.razorpay.com',
                'https://connect.facebook.net',
                'https://www.googletagmanager.com',
                'https://www.clarity.ms'
            ],
            'script-src-attr': ["'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'style-src-attr': ["'unsafe-inline'"],
            'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
            'img-src': [
                "'self'",
                'data:',
                'https://*.razorpay.com',
                'https://www.facebook.com',
                'https://www.google-analytics.com',
                'https://*.google-analytics.com',
                'https://www.googletagmanager.com',
                'https://*.clarity.ms',
                'https://c.clarity.ms'
            ],
            'frame-src': [
                'https://checkout.razorpay.com',
                'https://api.razorpay.com'
            ],
            'connect-src': [
                "'self'",
                'https://api.razorpay.com',
                'https://www.facebook.com',
                'https://www.google-analytics.com',
                'https://*.google-analytics.com',
                'https://*.analytics.google.com',
                'https://*.clarity.ms',
                'https://w.clarity.ms'
            ],
        },
    },
}));

app.use(compression());
app.use(morgan(isDev ? 'dev' : 'combined'));

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { status: 'error', message: 'Too many requests' }
});

const litellm = axios.create({
    baseURL: process.env.LITELLM_URL,
    headers: { 'x-litellm-api-key': process.env.LITELLM_MASTER_KEY }
});

const razorpay = axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: {
        username: process.env.RAZORPAY_KEY_ID || '',
        password: process.env.RAZORPAY_KEY_SECRET || ''
    },
    timeout: 15000
});

function assertRazorpayConfigured() {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials are not configured');
    }
}

// --- PLUGIN ZIP GENERATOR ---
const PLUGIN_TEMPLATE_PATH = path.join(__dirname, 'private', 'plugin.zip');
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');
const PLACEHOLDER = 'PROD_CUSTOMER_API_KEY';

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

let templateFiles = null;
try {
    const buf = fs.readFileSync(PLUGIN_TEMPLATE_PATH);
    templateFiles = unzipSync(new Uint8Array(buf));
    console.log(`[plugin] Template loaded: ${Object.keys(templateFiles).length} entries from ${path.basename(PLUGIN_TEMPLATE_PATH)}`);
} catch (e) {
    console.warn(`[plugin] WARNING: Could not load plugin template - ${e.message}`);
    console.warn(`[plugin] Place your zip at: ${PLUGIN_TEMPLATE_PATH}`);
}

function generatePlugin(apiKey) {
    if (!templateFiles) throw new Error('Plugin template not loaded');

    const out = {};
    for (const [name, data] of Object.entries(templateFiles)) {
        const str = strFromU8(data, true);
        if (str.includes(PLACEHOLDER)) {
            out[name] = strToU8(str.replaceAll(PLACEHOLDER, apiKey));
        } else {
            out[name] = data;
        }
    }

    const zipped = zipSync(out);
    const filename = `plugin-${crypto.randomUUID()}.zip`;
    fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), zipped);
    return filename;
}

// --- IN-MEMORY ORDER + FULFILLMENT STATE ---
const pendingOrders = new Map();
const fulfillmentByOrder = new Map();
const processedPaymentIds = new Set();
const ORDER_STATE_TTL_MS = 24 * 60 * 60 * 1000;

function nowMs() {
    return Date.now();
}

function markFulfillment(orderId, patch) {
    const existing = fulfillmentByOrder.get(orderId) || {};
    fulfillmentByOrder.set(orderId, {
        ...existing,
        ...patch,
        updatedAt: nowMs()
    });
}

function cleanupOrderState() {
    const cutoff = nowMs() - ORDER_STATE_TTL_MS;

    for (const [orderId, data] of pendingOrders.entries()) {
        if ((data.createdAt || 0) < cutoff) {
            pendingOrders.delete(orderId);
        }
    }

    for (const [orderId, data] of fulfillmentByOrder.entries()) {
        if ((data.updatedAt || data.createdAt || 0) < cutoff) {
            fulfillmentByOrder.delete(orderId);
        }
    }
}

setInterval(cleanupOrderState, 60 * 60 * 1000).unref();

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const payload = `${orderId}|${paymentId}`;
    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(payload)
        .digest('hex');

    const sigA = Buffer.from(expected, 'utf8');
    const sigB = Buffer.from(signature || '', 'utf8');
    if (sigA.length !== sigB.length) return false;
    return crypto.timingSafeEqual(sigA, sigB);
}

function normalizeEmail(email) {
    if (!email) return null;
    const v = String(email).trim().toLowerCase();
    return v || null;
}

function normalizePhone(phone) {
    if (!phone) return null;
    const v = String(phone).replace(/[^\d]/g, '').trim();
    return v || null;
}

async function createRazorpayOrder({
    productId,
    flowType,
    topupKey = null,
    contactHint = null,
    existingCustomerId = null
}) {
    assertRazorpayConfigured();
    const product = getProductOrThrow(productId);
    const currency = String(paymentConfig.checkout?.currency || 'INR').toUpperCase();
    const amountPaise = Math.round(toNumber(product.amount_inr, 0) * 100);

    if (!amountPaise) throw new Error(`Invalid amount configured for product "${productId}"`);

    const receiptBase = `qwint_${flowType}_${product.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const receipt = receiptBase.slice(0, 40);

    const notes = {
        flow_type: flowType,
        product_id: product.id,
    };
    if (contactHint) notes.contact_hint = String(contactHint).slice(0, 255);
    if (existingCustomerId) notes.customer_id_hint = String(existingCustomerId).slice(0, 255);

    const response = await razorpay.post('/orders', {
        amount: amountPaise,
        currency,
        receipt,
        notes
    });

    const order = response.data;
    pendingOrders.set(order.id, {
        orderId: order.id,
        flowType,
        productId: product.id,
        topupKey,
        existingCustomerId: existingCustomerId || null,
        contactHint: normalizePhone(contactHint),
        createdAt: nowMs(),
        amountPaise,
        currency
    });

    markFulfillment(order.id, {
        status: 'awaiting_payment',
        orderId: order.id,
        createdAt: nowMs()
    });

    return { order, product };
}

async function capturePaymentIfNeeded(payment) {
    if (payment.status !== 'authorized') return payment;

    const capturedResp = await razorpay.post(`/payments/${payment.id}/capture`, {
        amount: payment.amount,
        currency: payment.currency
    });
    return capturedResp.data;
}

function safeCustomerNotesMerge(existingNotes = {}, patchNotes = {}) {
    return {
        ...existingNotes,
        ...patchNotes
    };
}

async function fetchRazorpayCustomer(customerId) {
    const resp = await razorpay.get(`/customers/${encodeURIComponent(customerId)}`);
    return resp.data;
}

function extractCustomerItems(listResponse) {
    const payload = listResponse?.data || {};
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
    return [];
}

async function findExistingRazorpayCustomer({ contact, email }) {
    // Razorpay list API returns newest customers first. We fetch a small window and match.
    const resp = await razorpay.get('/customers', { params: { count: 100, skip: 0 } });
    const items = extractCustomerItems(resp);

    const byContact = contact
        ? items.find((c) => normalizePhone(c.contact || '') === normalizePhone(contact))
        : null;
    if (byContact) return byContact;

    const byEmail = email
        ? items.find((c) => normalizeEmail(c.email || '') === normalizeEmail(email))
        : null;
    return byEmail || null;
}

async function upsertRazorpayCustomerFromPayment({ existingCustomerId = null, payment, orderContext }) {
    const email = normalizeEmail(payment.email || null);
    const contact = normalizePhone(payment.contact || orderContext?.contactHint || null);

    if (!contact) {
        throw new Error('Checkout must include phone number');
    }

    const baseNotes = {
        last_order_id: orderContext?.orderId || '',
        last_payment_id: payment.id || '',
        flow_type: orderContext?.flowType || '',
        product_id: orderContext?.productId || ''
    };

    if (existingCustomerId) {
        const existing = await fetchRazorpayCustomer(existingCustomerId);
        const updatePayload = {
            name: existing.name || `customer_${contact}`,
            email: email || existing.email || undefined,
            contact: contact || normalizePhone(existing.contact || '') || undefined,
            notes: safeCustomerNotesMerge(existing.notes || {}, baseNotes),
            fail_existing: '0'
        };
        const updated = await razorpay.put(`/customers/${encodeURIComponent(existingCustomerId)}`, updatePayload);
        return updated.data;
    }

    try {
        const createdResp = await razorpay.post('/customers', {
            name: `customer_${contact}`,
            email: email || undefined,
            contact,
            notes: baseNotes,
            fail_existing: '0'
        });
        return createdResp.data;
    } catch (createErr) {
        // Common in retries/duplicates: fetch and reuse existing customer.
        const existing = await findExistingRazorpayCustomer({ contact, email });
        if (existing?.id) return existing;

        const detail =
            createErr?.response?.data?.error?.description ||
            createErr?.response?.data?.error?.reason ||
            createErr?.response?.data?.error?.code ||
            createErr.message;
        throw new Error(`Razorpay customer upsert failed: ${detail}`);
    }
}

async function attachLiteLlmKeyToRazorpayCustomer(customerId, patch = {}) {
    if (!customerId) return;

    try {
        const existing = await fetchRazorpayCustomer(customerId);
        const updatedNotes = safeCustomerNotesMerge(existing.notes || {}, patch);

        await razorpay.put(`/customers/${encodeURIComponent(customerId)}`, {
            name: existing.name || `customer_${customerId}`,
            email: existing.email || undefined,
            contact: normalizePhone(existing.contact || '') || undefined,
            notes: updatedNotes,
            fail_existing: '0'
        });
    } catch (e) {
        logError('Unable to update Razorpay customer notes', e);
    }
}

async function processFulfillment(orderId, payment, razorpayCustomerId) {
    const context = pendingOrders.get(orderId);
    if (!context) {
        throw new Error('No pending order context found');
    }

    const product = getProductOrThrow(context.productId);
    const liteLlmPlan = getLiteLlmPlanConfig(product);
    const customerIdField = getPrimaryCustomerMetadataField();
    const paymentEmail = normalizeEmail(payment.email || null);
    const paymentPhone = normalizePhone(payment.contact || context.contactHint || null);
    const paymentCustomerId = razorpayCustomerId || payment.customer_id || context.existingCustomerId || null;

    markFulfillment(orderId, {
        status: 'processing',
        phone: paymentPhone,
        paymentId: payment.id,
        flowType: context.flowType,
        productId: context.productId
    });

    if (context.flowType === 'initial_buy') {
        const keyAlias = `${liteLlmPlan.team_id}_${paymentCustomerId || orderId}`;
        const keyResp = await litellm.post('/key/generate', {
            key_alias: keyAlias,
            max_budget: liteLlmPlan.key_budget,
            team_id: liteLlmPlan.team_id,
            models: liteLlmPlan.models,
            key_type: liteLlmPlan.key_type,
            metadata: {
                [customerIdField]: paymentCustomerId || orderId,
                razorpay_customer_id: paymentCustomerId || '',
                phone: paymentPhone || '',
                available_budget: liteLlmPlan.key_metadata_available_budget,
                flow_type: 'initial_buy',
                product_id: context.productId,
                ...liteLlmPlan.metadata
            }
        });

        const generatedKey = keyResp.data?.key;
        if (!generatedKey) throw new Error('LiteLLM key generation failed');

        const pluginFilename = generatePlugin(generatedKey);
        const pluginUrl = `/downloads/${pluginFilename}`;

        await attachLiteLlmKeyToRazorpayCustomer(paymentCustomerId, {
            litellm_key: generatedKey,
            plugin_zip_url: pluginUrl,
            flow_type: 'initial_buy',
            product_id: context.productId
        });

        markFulfillment(orderId, {
            status: 'ready',
            key: generatedKey,
            pluginUrl,
            completedAt: nowMs()
        });
        return;
    }

    if (context.flowType === 'top_up') {
        if (!context.topupKey) throw new Error('Top-up key missing from order context');

        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(context.topupKey)}`);
        const keyInfo = keyInfoResp.data?.info || keyInfoResp.data || {};
        const metadata = keyInfo.metadata || {};
        const currentAvailableBudget = toNumber(metadata.available_budget, 0);
        const currentMaxBudget = toNumber(keyInfo.max_budget, 0);
        const budgetIncrement = liteLlmPlan.key_metadata_available_budget;

        await litellm.post('/key/update', {
            key: context.topupKey,
            add_to_max_budget: currentMaxBudget + budgetIncrement,
            metadata: {
                ...metadata,
                available_budget: currentAvailableBudget + budgetIncrement,
                [customerIdField]: paymentCustomerId || metadata[customerIdField] || metadata.stripe_id || '',
                razorpay_customer_id: paymentCustomerId || metadata.razorpay_customer_id || '',
                phone: paymentPhone || metadata.phone || metadata.contact || '',
                flow_type: 'top_up',
                product_id: context.productId,
                ...liteLlmPlan.metadata
            }
        });

        await attachLiteLlmKeyToRazorpayCustomer(paymentCustomerId, {
            litellm_key: context.topupKey,
            flow_type: 'top_up',
            product_id: context.productId
        });

        markFulfillment(orderId, {
            status: 'ready',
            key: context.topupKey,
            pluginUrl: null,
            completedAt: nowMs()
        });
        return;
    }

    throw new Error(`Unsupported flow type: ${context.flowType}`);
}

function getCheckoutViewData() {
    return {
        products: paymentConfig.products,
        checkout: paymentConfig.checkout || {},
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || ''
    };
}

// --- ROUTES ---
app.get('/', (req, res) => {
    res.render('index', getCheckoutViewData());
});

app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/refund', (req, res) => res.render('refund'));
app.get('/support', (req, res) => res.render('support'));
app.get('/terms', (req, res) => res.render('terms'));

app.get('/topup', (req, res) => {
    res.render('topup', getCheckoutViewData());
});

app.get('/topup-success', (req, res) => res.render('topup-success'));

app.get('/api/products', (req, res) => {
    res.json({ products: paymentConfig.products });
});

app.post('/api/checkout', express.json(), async (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId is required' });

    try {
        const { order, product } = await createRazorpayOrder({
            productId,
            flowType: 'initial_buy'
        });

        res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: paymentConfig.checkout || {}
        });
    } catch (e) {
        logError('/api/checkout error', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/checkout-topup', express.json(), async (req, res) => {
    const { productId, key } = req.body;
    if (!productId || !key) return res.status(400).json({ error: 'productId and key are required' });

    try {
        // Validate key before creating an order.
        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(String(key).trim())}`);
        const keyInfo = keyInfoResp.data?.info || keyInfoResp.data || {};
        const metadata = keyInfo.metadata || keyInfoResp.data?.metadata || {};
        const customerIdField = getPrimaryCustomerMetadataField();
        const contactHint = normalizePhone(metadata.phone || metadata.contact || null);
        const existingCustomerId =
            metadata[customerIdField] ||
            metadata.razorpay_customer_id ||
            null;

        const { order, product } = await createRazorpayOrder({
            productId,
            flowType: 'top_up',
            topupKey: String(key).trim(),
            contactHint,
            existingCustomerId
        });

        res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: paymentConfig.checkout || {}
        });
    } catch (e) {
        logError('/api/checkout-topup error', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/payment/verify', express.json(), async (req, res) => {
    const {
        razorpay_payment_id: paymentId,
        razorpay_order_id: orderId,
        razorpay_signature: signature
    } = req.body;

    if (!paymentId || !orderId || !signature) {
        return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const context = pendingOrders.get(orderId);
    if (!context) {
        return res.status(404).json({ error: 'Order context not found or expired' });
    }

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const paymentResp = await razorpay.get(`/payments/${paymentId}`);
        let payment = paymentResp.data;
        payment = await capturePaymentIfNeeded(payment);

        if (payment.status !== 'captured') {
            return res.status(400).json({ error: `Payment not captured. Current status: ${payment.status}` });
        }

        const razorpayCustomer = await upsertRazorpayCustomerFromPayment({
            existingCustomerId: context.existingCustomerId || payment.customer_id || null,
            payment,
            orderContext: context
        });
        markFulfillment(orderId, {
            customerId: razorpayCustomer.id
        });

        if (!processedPaymentIds.has(paymentId)) {
            processedPaymentIds.add(paymentId);
            processFulfillment(orderId, payment, razorpayCustomer.id).catch((err) => {
                logError('fulfillment failed', err);
                markFulfillment(orderId, { status: 'error', message: err.message });
            });
        }

        const redirectUrl = context.flowType === 'top_up'
            ? '/topup-success'
            : `/success?order_id=${encodeURIComponent(orderId)}&payment_id=${encodeURIComponent(paymentId)}`;

        res.json({ ok: true, redirectUrl });
    } catch (e) {
        logError('/api/payment/verify error', e);
        if (e?.response?.data) {
            logError('/api/payment/verify error payload', e.response.data);
        }
        markFulfillment(orderId, { status: 'error', message: e.message });
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/topup-info', express.json(), async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const key = String(query).trim();
    try {
        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(key)}`);
        const info = keyInfoResp.data?.info || keyInfoResp.data || {};
        const metadata = info.metadata || keyInfoResp.data?.metadata || {};
        const customerIdField = getPrimaryCustomerMetadataField();

        res.json({
            customerId: metadata[customerIdField] || metadata.razorpay_customer_id || metadata.stripe_id || null,
            phone: metadata.phone || metadata.contact || null,
            key,
            available_budget: metadata.available_budget || 0
        });
    } catch (e) {
        console.error('[topup-info] Error:', e.message);
        return res.status(404).json({ error: 'Invalid LiteLLM key or not found.' });
    }
});

app.post('/api/generate-plugin', express.json(), (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });

    try {
        const filename = generatePlugin(key);
        const url = `/downloads/${filename}`;
        res.json({ url });
    } catch (e) {
        logError('Plugin generation API failed', e);
        res.status(500).json({ error: 'Failed to generate plugin' });
    }
});

app.get('/success', async (req, res) => {
    const { order_id: orderId, payment_id: paymentId } = req.query;
    if (!orderId) return res.redirect('/');

    const context = pendingOrders.get(orderId);
    const status = fulfillmentByOrder.get(orderId) || {};

    let amount = null;
    let currency = (paymentConfig.checkout?.currency || 'INR').toUpperCase();

    try {
        const orderResp = await razorpay.get(`/orders/${encodeURIComponent(orderId)}`);
        const amountPaise = toNumber(orderResp.data?.amount, 0);
        amount = amountPaise ? (amountPaise / 100).toFixed(2) : null;
        if (orderResp.data?.currency) currency = String(orderResp.data.currency).toUpperCase();
    } catch (e) {
        logInfo('[success] order fetch fallback', { orderId, reason: e.message });
    }

    res.render('success', {
        order_id: orderId,
        payment_id: paymentId || status.paymentId || null,
        orderDetails: {
            order_id: orderId,
            payment_id: paymentId || status.paymentId || null,
            phone: status.phone || context?.contactHint || null,
            customer_id: status.customerId || context?.existingCustomerId || null,
            amount,
            currency
        }
    });
});

app.get('/api/check-key', apiLimiter, async (req, res) => {
    const { order_id: orderId } = req.query;
    if (!orderId) return res.status(400).json({ status: 'error', message: 'Missing order_id' });

    const state = fulfillmentByOrder.get(orderId);
    if (!state) {
        return res.json({ status: 'processing' });
    }

    if (state.status === 'error') {
        return res.status(500).json({ status: 'error', message: state.message || 'Fulfillment failed' });
    }

    if (state.status === 'ready') {
        return res.json({
            status: 'ready',
            key: state.key || null,
            pluginUrl: state.pluginUrl || null
        });
    }

    return res.json({ status: 'processing' });
});

app.get('/billing/portal', (req, res) => {
    res.status(410).send('Billing portal is not available for Razorpay purchases. Please contact support@qwintsoft.com.');
});

app.post('/billing/portal-by-email', express.json(), (req, res) => {
    res.status(410).json({ error: 'Billing portal is not available for Razorpay purchases. Please contact support.' });
});

app.get('/api/key-info', express.json(), async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });

    try {
        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(String(key).trim())}`);
        const metadata = keyInfoResp.data?.metadata || keyInfoResp.data?.info?.metadata || {};
        const availableBudget = metadata.available_budget || 0;
        res.json({ available_budget: availableBudget });
    } catch (e) {
        console.error('[key-info] Error:', e.message);
        return res.status(404).json({ error: 'Invalid LiteLLM key or not found.' });
    }
});

app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\nServer is running');
    console.log(`Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
    console.log(`Local URL: http://localhost:${PORT}`);
});
