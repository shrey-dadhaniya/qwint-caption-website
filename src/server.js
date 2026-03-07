require('dotenv').config();
process.env.NODE_ENV = 'production';

const express = require('express');
const axios = require('axios');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { logDebug, logInfo, logWarn, logError, morganStream } = require('./utils/logger');

// ── Global crash guard ──────────────────────────────────────────────────
// Without these, any unhandled exception/rejection kills the process silently.
// cloudflared then sees an EOF (TCP close with no HTTP response) and retries.
process.on('uncaughtException', (err) => {
    logError('[process] uncaughtException — server is still running', err);
});
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logError('[process] unhandledRejection — server is still running', err);
});

const app = express();

const ROOT_DIR = path.join(__dirname, '..');
const PAYMENT_CONFIG_PATH = path.join(ROOT_DIR, 'payment-config.json');
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');

const fallbackProducts = [
    {
        id: 'a',
        name: 'Package A',
        amount_inr: 199,
        description: 'Ideal for trying out caption generation on short projects.',
        credits_minutes: 60,
        includes: ['60 caption minutes', 'Fast AI processing', 'Credits do not expire'],
        tagline: 'STARTER',
        tax_note: '+ Tax'
    },
    {
        id: 'b',
        name: 'Package B',
        amount_inr: 499,
        description: 'Balanced pack for active creators with recurring caption needs.',
        credits_minutes: 180,
        includes: ['180 caption minutes', 'Priority queue processing', 'Credits do not expire'],
        tagline: 'MOST POPULAR',
        tax_note: '+ Tax'
    },
    {
        id: 'c',
        name: 'Package C',
        amount_inr: 999,
        description: 'High-volume pack for studios and teams managing large projects.',
        credits_minutes: 420,
        includes: ['420 caption minutes', 'Highest processing priority', 'Credits do not expire'],
        tagline: 'PRO',
        tax_note: '+ Tax'
    }
];

const DEFAULT_FREE_DOWNLOAD_CONFIG = {
    team_id: 'qwint_caption',
    models: ['whisper-1'],
    key_type: 'llm_api',
    key_budget: 1,
    metadata_available_budget: 1,
    metadata_customer_id_field: 'razorpay_customer_id',
    metadata: {
        source: 'qwint-caption-website',
        flow_type: 'free_download'
    }
};

const DEFAULT_PLUGIN_CONFIG = {
    template_zip_path: 'src/private/plugin.zip',
    key_placeholder: 'PROD_CUSTOMER_API_KEY'
};

const DEFAULT_PAYMENT_GATEWAY_CONFIG = {
    provider: 'razorpay',
    currency: 'INR',
    display_name: 'Qwint Caption',
    description: 'AI Caption Credits',
    theme_color: '#6A00FF'
};

const DEFAULT_LITELLM_KEY_DETAILS = {
    metadata_customer_id_field: DEFAULT_FREE_DOWNLOAD_CONFIG.metadata_customer_id_field,
    free_download: {
        team_id: DEFAULT_FREE_DOWNLOAD_CONFIG.team_id,
        models: DEFAULT_FREE_DOWNLOAD_CONFIG.models,
        key_type: DEFAULT_FREE_DOWNLOAD_CONFIG.key_type,
        key_budget: DEFAULT_FREE_DOWNLOAD_CONFIG.key_budget,
        metadata_available_budget: DEFAULT_FREE_DOWNLOAD_CONFIG.metadata_available_budget,
        metadata: DEFAULT_FREE_DOWNLOAD_CONFIG.metadata
    }
};

function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toStringArray(value, fallback = []) {
    if (!Array.isArray(value)) return fallback;
    return value.map(String).map((v) => v.trim()).filter(Boolean);
}

function toProductsArray(value) {
    if (!Array.isArray(value) || value.length === 0) return fallbackProducts;

    const normalized = value
        .filter((p) => p && p.id && (p.name || p.package_name))
        .map((p) => ({
            id: String(p.id),
            name: String(p.name || p.package_name || p.id),
            amount_inr: Number.isFinite(Number(p.amount_inr ?? p.price_inr))
                ? Number(p.amount_inr ?? p.price_inr)
                : 0,
            description: String(p.description || ''),
            credits_minutes: Number.isFinite(Number(p.credits_minutes)) ? Number(p.credits_minutes) : 0,
            includes: (
                Array.isArray(p.includes)
                    ? p.includes
                    : (Array.isArray(p.benefits) ? p.benefits : [])
            ).map(String),
            tagline: String(p.tagline || ''),
            tax_note: String(p.tax_note || '+ Tax'),
            litellm: {
                team_id: String((p.litellm || {}).team_id || ''),
                key_type: String((p.litellm || {}).key_type || ''),
                models: toStringArray((p.litellm || {}).models, []),
                key_budget: toNumber((p.litellm || {}).key_budget, 0),
                metadata_available_budget: toNumber((p.litellm || {}).metadata_available_budget, 0),
                metadata: (p.litellm || {}).metadata || {}
            }
        }))
        .filter((p) => p.amount_inr > 0);

    return normalized.length > 0 ? normalized : fallbackProducts;
}

function loadRuntimeConfig() {
    try {
        if (!fs.existsSync(PAYMENT_CONFIG_PATH)) {
            return {
                free_download: DEFAULT_FREE_DOWNLOAD_CONFIG,
                litellm_key_details: DEFAULT_LITELLM_KEY_DETAILS,
                plugin: DEFAULT_PLUGIN_CONFIG,
                payment_gateway: DEFAULT_PAYMENT_GATEWAY_CONFIG,
                products: fallbackProducts
            };
        }

        const raw = fs.readFileSync(PAYMENT_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const litellmDetails = parsed.litellm_key_details || {};
        const free = parsed.free_download || litellmDetails.free_download || {};
        const plugin = parsed.plugin || {};
        const gateway = parsed.payment_gateway || {};
        const metadataCustomerIdField = String(
            free.metadata_customer_id_field ||
            litellmDetails.metadata_customer_id_field ||
            DEFAULT_FREE_DOWNLOAD_CONFIG.metadata_customer_id_field
        );

        const normalizedFreeDownload = {
            team_id: String(free.team_id || DEFAULT_FREE_DOWNLOAD_CONFIG.team_id),
            models: toStringArray(free.models, DEFAULT_FREE_DOWNLOAD_CONFIG.models),
            key_type: String(free.key_type || DEFAULT_FREE_DOWNLOAD_CONFIG.key_type),
            key_budget: toNumber(free.key_budget, DEFAULT_FREE_DOWNLOAD_CONFIG.key_budget),
            metadata_available_budget: toNumber(
                free.metadata_available_budget,
                DEFAULT_FREE_DOWNLOAD_CONFIG.metadata_available_budget
            ),
            metadata_customer_id_field: metadataCustomerIdField,
            metadata: {
                ...DEFAULT_FREE_DOWNLOAD_CONFIG.metadata,
                ...(free.metadata || {})
            }
        };

        // ── Filter by enabled_products ────────────────────────────────────────
        // If enabled_products is present in config, only those product IDs are
        // shown on the website and available for checkout.
        const allProducts = toProductsArray(parsed.products);
        const enabledIds = Array.isArray(parsed.enabled_products)
            ? parsed.enabled_products.map(String).filter(Boolean)
            : null; // null = no filter, all products shown

        const products = enabledIds && enabledIds.length > 0
            ? allProducts.filter((p) => enabledIds.includes(p.id))
            : allProducts;

        return {
            free_download: normalizedFreeDownload,
            litellm_key_details: {
                metadata_customer_id_field: metadataCustomerIdField,
                free_download: {
                    team_id: String(
                        (litellmDetails.free_download || {}).team_id ||
                        normalizedFreeDownload.team_id
                    ),
                    models: toStringArray(
                        (litellmDetails.free_download || {}).models,
                        normalizedFreeDownload.models
                    ),
                    key_type: String(
                        (litellmDetails.free_download || {}).key_type ||
                        normalizedFreeDownload.key_type
                    ),
                    key_budget: toNumber(
                        (litellmDetails.free_download || {}).key_budget,
                        normalizedFreeDownload.key_budget
                    ),
                    metadata_available_budget: toNumber(
                        (litellmDetails.free_download || {}).metadata_available_budget,
                        normalizedFreeDownload.metadata_available_budget
                    ),
                    metadata: {
                        ...normalizedFreeDownload.metadata,
                        ...((litellmDetails.free_download || {}).metadata || {})
                    }
                }
            },
            plugin: {
                template_zip_path: String(plugin.template_zip_path || DEFAULT_PLUGIN_CONFIG.template_zip_path),
                key_placeholder: String(plugin.key_placeholder || DEFAULT_PLUGIN_CONFIG.key_placeholder)
            },
            payment_gateway: {
                provider: String(gateway.provider || DEFAULT_PAYMENT_GATEWAY_CONFIG.provider),
                currency: String(gateway.currency || DEFAULT_PAYMENT_GATEWAY_CONFIG.currency).toUpperCase(),
                display_name: String(gateway.display_name || DEFAULT_PAYMENT_GATEWAY_CONFIG.display_name),
                description: String(gateway.description || DEFAULT_PAYMENT_GATEWAY_CONFIG.description),
                theme_color: String(gateway.theme_color || DEFAULT_PAYMENT_GATEWAY_CONFIG.theme_color)
            },
            products,
            enabledProductIds: enabledIds || allProducts.map((p) => p.id)
        };
    } catch (err) {
        logWarn('[server] Could not parse payment-config.json, using defaults', { error: err.message });
        return {
            free_download: DEFAULT_FREE_DOWNLOAD_CONFIG,
            litellm_key_details: DEFAULT_LITELLM_KEY_DETAILS,
            plugin: DEFAULT_PLUGIN_CONFIG,
            payment_gateway: DEFAULT_PAYMENT_GATEWAY_CONFIG,
            products: fallbackProducts
        };
    }
}

const runtimeConfig = loadRuntimeConfig();
// productsById is built from the FILTERED list — disabled products can never be checked out
const productsById = new Map(runtimeConfig.products.map((p) => [p.id, p]));
logInfo('[config] products enabled', { ids: runtimeConfig.products.map((p) => p.id) });

const litellm = axios.create({
    baseURL: process.env.LITELLM_URL,
    headers: { 'x-litellm-api-key': process.env.LITELLM_MASTER_KEY },
    timeout: 20000
});

const razorpay = axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: {
        username: process.env.RAZORPAY_KEY_ID || '',
        password: process.env.RAZORPAY_KEY_SECRET || ''
    },
    timeout: 20000
});

const pendingOrders = new Map();
const fulfillmentByOrder = new Map();
const processedPaymentIds = new Set();
// In-memory lock: claimed synchronously BEFORE the first await in doWebhookFulfillment.
// Because Node.js is single-threaded, setting this before any await ensures that
// concurrent webhook retries (fired within milliseconds) see it and exit immediately
// — even though fulfilled-orders.json hasn't been written yet.
const fulfillmentInProgress = new Set();
const ORDER_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const ORDER_STATE_DIR = path.join(__dirname, 'private', 'runtime');
const ORDER_STATE_FILE = path.join(ORDER_STATE_DIR, 'payment-state.json');
const ORDER_STATE_WRITE_DEBOUNCE_MS = 250;
const RAZORPAY_WEBHOOK_PATH = '/api/webhooks/razorpay';
let orderStateWriteTimer = null;

// ── Fulfilled Orders — simple JSON file keyed by orderId ─────────────────────
// This is the single source of truth for paid_checkout fulfillment status.
// Webhook writes here once fulfillment is done; check-key reads from here.
const FULFILLED_ORDERS_FILE = path.join(
    path.join(__dirname, 'private', 'runtime'),
    'fulfilled-orders.json'
);
let fulfilledOrders = {}; // { [orderId]: { key, zipUrl, customerId, paymentId, completedAt } }

function loadFulfilledOrders() {
    try {
        if (!fs.existsSync(FULFILLED_ORDERS_FILE)) return;
        const raw = fs.readFileSync(FULFILLED_ORDERS_FILE, 'utf8');
        fulfilledOrders = raw ? (JSON.parse(raw) || {}) : {};
        logInfo('[fulfilled-orders] loaded from disk', { count: Object.keys(fulfilledOrders).length });
    } catch (err) {
        logError('[fulfilled-orders] load failed', err);
    }
}

function saveFulfilledOrder(orderId, data) {
    fulfilledOrders[String(orderId)] = { ...data, savedAt: new Date().toISOString() };
    try {
        const dir = path.join(__dirname, 'private', 'runtime');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(FULFILLED_ORDERS_FILE, JSON.stringify(fulfilledOrders, null, 2), 'utf8');
        logDebug('[fulfilled-orders] saved to disk', { orderId });
    } catch (err) {
        logError('[fulfilled-orders] save failed', err);
    }
}

function getFulfilledOrder(orderId) {
    return fulfilledOrders[String(orderId)] || null;
}

function persistOrderStateNow() {
    try {
        fs.mkdirSync(ORDER_STATE_DIR, { recursive: true });
        const payload = {
            version: 1,
            saved_at: new Date().toISOString(),
            pendingOrders: Array.from(pendingOrders.entries()),
            fulfillmentByOrder: Array.from(fulfillmentByOrder.entries()),
            processedPaymentIds: Array.from(processedPaymentIds.values())
        };
        fs.writeFileSync(ORDER_STATE_FILE, JSON.stringify(payload), 'utf8');
        logDebug('[order-state] persisted to disk');
    } catch (err) {
        logError('[order-state] persist failed', err);
    }
}

function persistOrderStateSoon() {
    if (orderStateWriteTimer) return;
    orderStateWriteTimer = setTimeout(() => {
        orderStateWriteTimer = null;
        persistOrderStateNow();
    }, ORDER_STATE_WRITE_DEBOUNCE_MS);
    if (typeof orderStateWriteTimer.unref === 'function') {
        orderStateWriteTimer.unref();
    }
}

function loadPersistedOrderState() {
    try {
        if (!fs.existsSync(ORDER_STATE_FILE)) return;
        const raw = fs.readFileSync(ORDER_STATE_FILE, 'utf8');
        if (!raw) return;
        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed.pendingOrders)) {
            parsed.pendingOrders.forEach(([orderId, value]) => {
                if (orderId && value) pendingOrders.set(String(orderId), value);
            });
        }

        if (Array.isArray(parsed.fulfillmentByOrder)) {
            parsed.fulfillmentByOrder.forEach(([orderId, value]) => {
                if (orderId && value) fulfillmentByOrder.set(String(orderId), value);
            });
        }

        if (Array.isArray(parsed.processedPaymentIds)) {
            parsed.processedPaymentIds.forEach((paymentId) => {
                if (paymentId) processedPaymentIds.add(String(paymentId));
            });
        }
        logInfo('[order-state] loaded from disk', {
            pendingOrders: pendingOrders.size,
            fulfillments: fulfillmentByOrder.size,
            processedPayments: processedPaymentIds.size
        });
    } catch (err) {
        logError('[order-state] load failed', err);
    }
}

function setPendingOrder(orderId, value) {
    pendingOrders.set(String(orderId), value);
    persistOrderStateSoon();
}

function addProcessedPaymentId(paymentId) {
    const id = String(paymentId || '').trim();
    if (!id) return false;
    if (processedPaymentIds.has(id)) return false;
    processedPaymentIds.add(id);
    persistOrderStateSoon();
    return true;
}

function hasProcessedPaymentId(paymentId) {
    const id = String(paymentId || '').trim();
    if (!id) return false;
    return processedPaymentIds.has(id);
}

function ensureLiteLlmConfigured() {
    if (!process.env.LITELLM_URL || !process.env.LITELLM_MASTER_KEY) {
        throw new Error('LiteLLM credentials are not configured');
    }
}

function ensureFlowProvidersConfigured() {
    ensureLiteLlmConfigured();
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        throw new Error('Razorpay credentials are not configured');
    }
}

function getProductOrThrow(productId) {
    const product = productsById.get(String(productId || '').trim());
    if (!product) {
        throw new Error(`Unknown product id: ${productId}`);
    }
    return product;
}

function getLiteLlmPlanForProduct(product) {
    const freeDefaults = runtimeConfig.litellm_key_details.free_download || {};
    const plan = product.litellm || {};

    return {
        team_id: String(plan.team_id || freeDefaults.team_id || runtimeConfig.free_download.team_id),
        key_type: String(plan.key_type || freeDefaults.key_type || runtimeConfig.free_download.key_type),
        models: toStringArray(plan.models, toStringArray(freeDefaults.models, runtimeConfig.free_download.models)),
        key_budget: toNumber(plan.key_budget, toNumber(freeDefaults.key_budget, toNumber(product.credits_minutes, runtimeConfig.free_download.key_budget))),
        metadata_available_budget: toNumber(
            plan.metadata_available_budget,
            toNumber(freeDefaults.metadata_available_budget, toNumber(product.credits_minutes, runtimeConfig.free_download.metadata_available_budget))
        ),
        metadata: {
            ...(runtimeConfig.free_download.metadata || {}),
            ...(freeDefaults.metadata || {}),
            ...(plan.metadata || {})
        }
    };
}

function getMetadataCustomerIdField() {
    return (
        runtimeConfig.litellm_key_details.metadata_customer_id_field ||
        runtimeConfig.free_download.metadata_customer_id_field ||
        'razorpay_customer_id'
    );
}

function getOrderContextCustomerId(metadata) {
    const customerIdField = getMetadataCustomerIdField();
    return (
        metadata?.[customerIdField] ||
        metadata?.razorpay_customer_id ||
        metadata?.stripe_id ||
        null
    );
}

function toLiteLlmInfoPayload(rawPayload) {
    const payload = rawPayload || {};
    const info = (payload.info && typeof payload.info === 'object') ? payload.info : payload;
    const metadata = (info.metadata && typeof info.metadata === 'object')
        ? info.metadata
        : ((payload.metadata && typeof payload.metadata === 'object') ? payload.metadata : {});

    return {
        info,
        metadata
    };
}

async function getLiteLlmKeyInfo(key) {
    const rawKey = String(key || '').trim();
    if (!rawKey) throw new Error('LiteLLM key is required');

    ensureLiteLlmConfigured();

    const response = await litellm.get(`/key/info?key=${encodeURIComponent(rawKey)}`);
    const parsed = toLiteLlmInfoPayload(response.data);
    const metadata = parsed.metadata || {};
    const availableBudget = toNumber(metadata.available_budget, 0);
    const maxBudgetRaw = parsed.info?.max_budget;
    const hasMaxBudget = Number.isFinite(Number(maxBudgetRaw));

    return {
        key: rawKey,
        info: parsed.info || {},
        metadata,
        availableBudget,
        maxBudget: hasMaxBudget ? Number(maxBudgetRaw) : null,
        hasMaxBudget
    };
}

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
    persistOrderStateSoon();
}

function cleanupOrderState() {
    const cutoff = nowMs() - ORDER_STATE_TTL_MS;
    let changed = false;

    for (const [orderId, data] of pendingOrders.entries()) {
        if ((data.createdAt || 0) < cutoff) {
            pendingOrders.delete(orderId);
            changed = true;
        }
    }

    for (const [orderId, data] of fulfillmentByOrder.entries()) {
        if ((data.updatedAt || data.createdAt || 0) < cutoff) {
            fulfillmentByOrder.delete(orderId);
            changed = true;
        }
    }

    for (const paymentId of processedPaymentIds.values()) {
        if (!paymentId) {
            processedPaymentIds.delete(paymentId);
            changed = true;
        }
    }

    if (changed) persistOrderStateSoon();
}

loadPersistedOrderState();
loadFulfilledOrders();
cleanupOrderState();
setInterval(cleanupOrderState, 60 * 60 * 1000).unref();

function timingSafeHexEqual(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
    const payload = `${orderId}|${paymentId}`;
    const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(payload)
        .digest('hex');

    return timingSafeHexEqual(expected, signature);
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    if (!secret) return false;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody || '')
        .digest('hex');
    return timingSafeHexEqual(expected, signature);
}

function normalizeEmail(email) {
    if (!email) return null;
    const value = String(email).trim().toLowerCase();
    return value || null;
}

// Razorpay substitutes void@razorpay.com when no real email is provided.
// Using it for customer lookup would match the first customer ever created
// without a real email, giving all such payments the same customer ID.
const RAZORPAY_VOID_EMAILS = new Set([
    'void@razorpay.com',
    'noemail@razorpay.com',
    'no-reply@razorpay.com'
]);
function isRazorpayPlaceholderEmail(email) {
    return !!email && RAZORPAY_VOID_EMAILS.has(String(email).trim().toLowerCase());
}

// ── Cookie helpers (no cookie-parser dependency) ─────────────────────────
const BYPASS_COOKIE_NAME = '_qw_bypass';

function parseCookies(req) {
    const out = {};
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        out[key] = decodeURIComponent(val);
    }
    return out;
}

function hasBypassCookie(req) {
    return parseCookies(req)[BYPASS_COOKIE_NAME] === '1';
}

function normalizePhone(phone) {
    if (!phone) return null;
    const value = String(phone).replace(/[^\d]/g, '').trim();
    return value || null;
}

function normalizeIndianPhone(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    if (/^[6-9]\d{9}$/.test(digits)) return digits;
    if (/^0[6-9]\d{9}$/.test(digits)) return digits.slice(1);
    if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2);
    return null;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function isValidPhone(phone) {
    return !!normalizeIndianPhone(phone);
}

function extractCustomerItems(payload) {
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

function extractPaymentItems(payload) {
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.payments)) return payload.payments;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

function normalizeRazorpayContact(contact) {
    return normalizeIndianPhone(contact) || null;
}

function normalizeLiteLlmKey(value) {
    const key = String(value || '').trim();
    if (!key) return null;
    return key.startsWith('sk-') ? key : null;
}

async function findRazorpayCustomerByEmail(email) {
    const response = await razorpay.get('/customers', { params: { count: 100, skip: 0 } });
    const items = extractCustomerItems(response.data);
    return items.find((item) => normalizeEmail(item.email) === normalizeEmail(email)) || null;
}

async function findRazorpayCustomerByContact(contact) {
    const targetIndian = normalizeIndianPhone(contact);
    const targetAny = normalizePhone(contact);
    const response = await razorpay.get('/customers', { params: { count: 100, skip: 0 } });
    const items = extractCustomerItems(response.data);
    return items.find((item) => {
        const itemIndian = normalizeIndianPhone(item.contact);
        if (targetIndian && itemIndian) return itemIndian === targetIndian;
        return normalizePhone(item.contact) === targetAny;
    }) || null;
}

async function upsertRazorpayCustomerByEmail(email) {
    const displayName = `free_${email.split('@')[0]}`.slice(0, 48);
    try {
        const created = await razorpay.post('/customers', {
            name: displayName,
            email,
            notes: {
                flow_type: 'free_download'
            },
            fail_existing: '0'
        });
        return created.data;
    } catch (err) {
        const existing = await findRazorpayCustomerByEmail(email);
        if (existing) return existing;

        const detail =
            err?.response?.data?.error?.description ||
            err?.response?.data?.error?.reason ||
            err?.response?.data?.error?.code ||
            err.message;
        throw new Error(`Unable to create/find Razorpay customer: ${detail}`);
    }
}

async function upsertRazorpayCustomerByContact(contact) {
    const safeContact = normalizeIndianPhone(contact);
    if (!safeContact) {
        throw new Error('A valid Indian phone number is required');
    }
    const displayName = `free_${safeContact}`.slice(0, 48);
    try {
        const created = await razorpay.post('/customers', {
            name: displayName,
            contact: safeContact,
            notes: {
                flow_type: 'free_download'
            },
            fail_existing: '0'
        });
        return created.data;
    } catch (err) {
        const existing = await findRazorpayCustomerByContact(safeContact);
        if (existing) return existing;

        const detail =
            err?.response?.data?.error?.description ||
            err?.response?.data?.error?.reason ||
            err?.response?.data?.error?.code ||
            err.message;
        throw new Error(`Unable to create/find Razorpay customer: ${detail}`);
    }
}

async function updateRazorpayCustomerNotes(customer, notesPatch) {
    const customerId = String(customer?.id || '').trim();
    if (!customerId) {
        logError('[updateRazorpayCustomerNotes] called without valid customer id');
        return;
    }

    // Always fetch fresh customer — caller may have a slim { id, email, contact }
    // object without notes, which would cause an overwrite instead of a merge.
    let current = null;
    try {
        const fetched = await razorpay.get(`/customers/${encodeURIComponent(customerId)}`);
        current = fetched.data;
        logDebug('[updateRazorpayCustomerNotes] fetched customer', {
            customerId,
            existingNoteKeys: Object.keys(current.notes || {})
        });
    } catch (err) {
        logWarn('[updateRazorpayCustomerNotes] could not fetch customer, using provided object', {
            customerId, error: err.message
        });
        current = customer;
    }

    // Merge: existing notes + patch (patch wins on conflicts)
    const mergedNotes = {
        ...((current && current.notes) || {}),
        ...(notesPatch || {})
    };

    // Razorpay notes are capped at 15 key-value pairs.
    // If over limit, drop oldest existing keys but always keep the patch keys.
    const MAX_NOTES_KEYS = 15;
    let finalNotes = mergedNotes;
    if (Object.keys(mergedNotes).length > MAX_NOTES_KEYS) {
        const patchKeys = new Set(Object.keys(notesPatch || {}));
        const extraKeys = Object.keys((current && current.notes) || {}).filter(k => !patchKeys.has(k));
        const keepSlots = MAX_NOTES_KEYS - patchKeys.size;
        const keptExtra = extraKeys.slice(-keepSlots);
        finalNotes = {};
        for (const k of keptExtra) finalNotes[k] = mergedNotes[k];
        for (const k of patchKeys) finalNotes[k] = mergedNotes[k];
        logWarn('[updateRazorpayCustomerNotes] trimmed notes to 15-key limit', {
            customerId,
            dropped: extraKeys.slice(0, extraKeys.length - keepSlots)
        });
    }

    const putPayload = {
        name: (current && current.name) || `customer_${customerId}`,
        email: (current && current.email) || undefined,
        contact: (current && current.contact) || undefined,
        notes: finalNotes,
        fail_existing: '0'
    };

    logDebug('[updateRazorpayCustomerNotes] sending PUT', {
        customerId,
        noteKeys: Object.keys(finalNotes),
        hasLitellmKey: !!finalNotes.litellm_key,
        hasZipUrl: !!finalNotes.plugin_zip_url
    });

    try {
        await razorpay.put(`/customers/${encodeURIComponent(customerId)}`, putPayload);
        logInfo('[updateRazorpayCustomerNotes] notes updated successfully', {
            customerId,
            noteKeys: Object.keys(finalNotes)
        });
    } catch (err) {
        logError('[updateRazorpayCustomerNotes] PUT failed', err);
        throw err; // re-throw so caller knows it failed
    }
}

async function upsertRazorpayCustomerFromPayment(payment, orderContext) {
    const rawEmail = normalizeEmail(payment.email || orderContext?.emailHint || null);
    // Discard Razorpay placeholder — using it for lookup returns the wrong customer
    const email = rawEmail && !isRazorpayPlaceholderEmail(rawEmail) ? rawEmail : null;
    const contact = normalizeRazorpayContact(payment.contact || orderContext?.contactHint || null);
    const customerId = String(payment.customer_id || orderContext?.customerIdHint || '').trim() || null;
    const flowType = String(orderContext?.flowType || 'paid_checkout');
    const litellmKey = normalizeLiteLlmKey(orderContext?.litellmKeyHint || null);

    logDebug('[upsertRazorpayCustomer] resolving customer', {
        hasCustomerId: !!customerId,
        hasEmail: !!email,
        rawEmailSkipped: rawEmail !== email,
        hasContact: !!contact,
        flowType
    });

    const baseNotes = {
        flow_type: flowType,
        product_id: orderContext?.productId || '',
        last_order_id: orderContext?.orderId || '',
        last_payment_id: payment.id || ''
    };
    if (litellmKey) baseNotes.litellm_key = litellmKey;

    const updatePayloadFrom = (existing, nameFallback) => ({
        name: (existing && existing.name) || nameFallback || `customer_${Date.now()}`,
        email: email || (existing && normalizeEmail(existing.email)) || undefined,
        contact: contact || (existing && normalizeRazorpayContact(existing.contact)) || undefined,
        notes: {
            ...((existing && existing.notes) || {}),
            ...baseNotes
        },
        fail_existing: '0'
    });

    if (customerId) {
        try {
            const existing = await razorpay.get(`/customers/${encodeURIComponent(customerId)}`);
            const customer = existing.data;
            await razorpay.put(
                `/customers/${encodeURIComponent(customerId)}`,
                updatePayloadFrom(customer, `customer_${contact || email || customerId}`)
            );
            return {
                id: customerId,
                email: email || customer.email || null,
                contact: contact || normalizeRazorpayContact(customer.contact) || null
            };
        } catch (err) {
            // fall through to create/find by email/contact
        }
    }

    let existing = null;
    if (email) existing = await findRazorpayCustomerByEmail(email);
    if (!existing && contact) existing = await findRazorpayCustomerByContact(contact);

    if (existing) {
        await razorpay.put(
            `/customers/${encodeURIComponent(existing.id)}`,
            updatePayloadFrom(existing, `customer_${contact || email || existing.id}`)
        );
        return {
            id: existing.id,
            email: email || existing.email || null,
            contact: contact || normalizeRazorpayContact(existing.contact) || null
        };
    }

    if (!email && !contact) {
        throw new Error('Razorpay payment is missing email and phone; cannot create customer');
    }

    const createResp = await razorpay.post('/customers', {
        name: `customer_${contact || (email || 'guest').split('@')[0]}`,
        email: email || undefined,
        contact: contact || undefined,
        notes: baseNotes,
        fail_existing: '0'
    });

    return {
        id: createResp.data.id,
        email: email || createResp.data.email || null,
        contact: contact || normalizeRazorpayContact(createResp.data.contact) || null
    };
}

async function createFreeLiteLlmKey({ email, phone, razorpayCustomerId }) {
    const free = runtimeConfig.free_download;
    const customerIdField = free.metadata_customer_id_field || 'razorpay_customer_id';
    const alias = `free_${razorpayCustomerId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;

    const response = await litellm.post('/key/generate', {
        key_alias: alias,
        max_budget: free.key_budget,
        team_id: free.team_id,
        models: free.models,
        key_type: free.key_type,
        metadata: {
            [customerIdField]: razorpayCustomerId,
            razorpay_customer_id: razorpayCustomerId,
            email: email || '',
            phone: phone || '',
            available_budget: free.metadata_available_budget,
            ...free.metadata
        }
    });

    const key = response.data?.key;
    if (!key) {
        throw new Error('LiteLLM did not return a key');
    }
    return key;
}

async function createRazorpayOrderForProduct(productId, options = {}) {
    ensureFlowProvidersConfigured();
    const product = getProductOrThrow(productId);
    const currency = String(runtimeConfig.payment_gateway.currency || 'INR').toUpperCase();
    const naturalAmountPaise = Math.round(toNumber(product.amount_inr, 0) * 100);
    if (!naturalAmountPaise) throw new Error(`Invalid amount configured for product "${product.id}"`);

    // Bypass mode: override amount to ₹1 (100 paise) — Razorpay minimum; true ₹0 is not supported.
    const isBypass = !!options.bypass;
    const amountPaise = isBypass ? 100 : naturalAmountPaise;
    if (isBypass) {
        logInfo('[checkout] bypass mode active — overriding amount to ₹1', {
            productId, naturalAmountInr: product.amount_inr
        });
    }
    const flowType = String(options.flowType || 'paid_checkout');
    const notes = {
        flow_type: flowType,
        product_id: product.id,
        ...(isBypass ? { bypass: 'true' } : {}),
        ...(options.notes || {})
    };

    const receipt = `qwint_${product.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`.slice(0, 40);
    const response = await razorpay.post('/orders', {
        amount: amountPaise,
        currency,
        receipt,
        notes
    });

    const order = response.data;
    setPendingOrder(order.id, {
        orderId: order.id,
        productId: product.id,
        amountPaise,
        bypass: isBypass,
        currency,
        flowType,
        createdAt: nowMs(),
        ...(options.orderContext || {})
    });

    markFulfillment(order.id, {
        status: 'awaiting_payment',
        orderId: order.id,
        productId: product.id,
        flowType,
        createdAt: nowMs()
    });

    return { order, product };
}

async function capturePaymentIfNeeded(payment) {
    if (!payment || payment.status !== 'authorized') return payment;
    const captured = await razorpay.post(`/payments/${encodeURIComponent(payment.id)}/capture`, {
        amount: payment.amount,
        currency: payment.currency
    });
    return captured.data;
}

async function fetchRazorpayOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id) return null;
    const response = await razorpay.get(`/orders/${encodeURIComponent(id)}`);
    return response.data || null;
}

async function fetchRazorpayCustomer(customerId) {
    const id = String(customerId || '').trim();
    if (!id) return null;
    const response = await razorpay.get(`/customers/${encodeURIComponent(id)}`);
    return response.data || null;
}

async function fetchRazorpayPayment(paymentId) {
    const id = String(paymentId || '').trim();
    if (!id) return null;
    const response = await razorpay.get(`/payments/${encodeURIComponent(id)}`);
    return response.data || null;
}

async function fetchBestPaymentForOrder(orderId) {
    const id = String(orderId || '').trim();
    if (!id) return null;
    const response = await razorpay.get(`/orders/${encodeURIComponent(id)}/payments`);
    const items = extractPaymentItems(response.data)
        .filter((p) => p && p.id)
        .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
    const captured = items.find((p) => p.status === 'captured');
    if (captured) return captured;
    const authorized = items.find((p) => p.status === 'authorized');
    return authorized || null;
}

async function ensureCapturedPayment({ orderId, paymentId }) {
    let payment = null;
    if (paymentId) {
        payment = await fetchRazorpayPayment(paymentId);
    } else {
        payment = await fetchBestPaymentForOrder(orderId);
    }

    if (!payment) return null;
    if (orderId && payment.order_id && String(payment.order_id) !== String(orderId)) {
        throw new Error('Payment does not belong to this order');
    }

    payment = await capturePaymentIfNeeded(payment);
    if (!payment || payment.status !== 'captured') return null;
    return payment;
}

async function ensureOrderContext(orderId, hints = {}) {
    const id = String(orderId || '').trim();
    if (!id) return null;

    const existing = pendingOrders.get(id);
    if (existing) {
        let changed = false;
        const merged = { ...existing };

        if (!merged.topupKey) {
            const hintedKey = normalizeLiteLlmKey(hints.topupKey);
            if (hintedKey) {
                merged.topupKey = hintedKey;
                changed = true;
            }
        }

        const hintedCustomerId = String(hints.customerIdHint || '').trim();
        if (!merged.existingCustomerId && hintedCustomerId) {
            merged.existingCustomerId = hintedCustomerId;
            changed = true;
        }

        const hintedEmail = normalizeEmail(hints.emailHint);
        if (!merged.emailHint && hintedEmail) {
            merged.emailHint = hintedEmail;
            changed = true;
        }

        const hintedContact = normalizeRazorpayContact(hints.contactHint);
        if (!merged.contactHint && hintedContact) {
            merged.contactHint = hintedContact;
            changed = true;
        }

        if (changed) setPendingOrder(id, merged);
        return changed ? merged : existing;
    }

    const order = await fetchRazorpayOrder(id);
    if (!order) return null;
    const flowType = String(order.notes?.flow_type || hints.flowType || 'paid_checkout');
    const productId = String(order.notes?.product_id || hints.productId || '').trim();

    if (!productId || !productsById.has(productId)) {
        throw new Error('Order product is missing or invalid');
    }

    const restored = {
        orderId: id,
        productId,
        amountPaise: toNumber(order.amount, 0),
        currency: String(order.currency || runtimeConfig.payment_gateway.currency || 'INR').toUpperCase(),
        flowType,
        createdAt: nowMs(),
        topupKey: normalizeLiteLlmKey(hints.topupKey || order.notes?.litellm_key),
        existingCustomerId: String(hints.customerIdHint || '').trim() || null,
        contactHint: normalizeRazorpayContact(hints.contactHint),
        emailHint: normalizeEmail(hints.emailHint)
    };

    setPendingOrder(id, restored);

    if (!fulfillmentByOrder.has(id)) {
        markFulfillment(id, {
            status: 'awaiting_payment',
            orderId: id,
            productId,
            flowType,
            createdAt: nowMs()
        });
    }

    return restored;
}

async function resolveTopupKey({ context, payment, topupKeyHint }) {
    const direct = normalizeLiteLlmKey(topupKeyHint || context?.topupKey);
    if (direct) return direct;

    const customerId = String(
        payment?.customer_id ||
        context?.existingCustomerId ||
        ''
    ).trim();

    if (!customerId) return null;

    try {
        const customer = await fetchRazorpayCustomer(customerId);
        return normalizeLiteLlmKey(customer?.notes?.litellm_key || null);
    } catch (_) {
        return null;
    }
}

async function restoreReadyStateFromArtifacts({ orderId, flowType, payment, context, topupKeyHint }) {
    const customerId = String(payment?.customer_id || context?.existingCustomerId || '').trim() || null;
    const customer = customerId ? await fetchRazorpayCustomer(customerId).catch(() => null) : null;
    const customerNotes = (customer && customer.notes) || {};
    const customerPhone = normalizeRazorpayContact(customer?.contact || null);

    if (flowType === 'paid_checkout') {
        const noteOrderId = String(customerNotes.order_id || '').trim();
        const key = normalizeLiteLlmKey(customerNotes.litellm_key || null);
        const pluginUrl = String(customerNotes.plugin_zip_url || '').trim() || null;

        if (noteOrderId === String(orderId) && key && pluginUrl) {
            markFulfillment(orderId, {
                status: 'ready',
                flowType: 'paid_checkout',
                key,
                pluginUrl,
                paymentId: payment?.id || null,
                customerId,
                phone: customerPhone,
                completedAt: nowMs()
            });
            return true;
        }
        return false;
    }

    if (flowType !== 'account_topup') return false;

    const key = normalizeLiteLlmKey(topupKeyHint || context?.topupKey || customerNotes.litellm_key || null);
    if (!key) return false;

    try {
        const keyInfo = await getLiteLlmKeyInfo(key);
        const metadata = keyInfo.metadata || {};
        const metadataOrderId = String(metadata.last_topup_order_id || '').trim();
        const metadataPaymentId = String(metadata.last_topup_payment_id || '').trim();

        if (
            metadataOrderId === String(orderId) ||
            (payment?.id && metadataPaymentId && metadataPaymentId === String(payment.id))
        ) {
            markFulfillment(orderId, {
                status: 'ready',
                flowType: 'account_topup',
                key,
                paymentId: payment?.id || null,
                customerId: getOrderContextCustomerId(metadata) || customerId || null,
                phone: normalizeRazorpayContact(metadata.phone || metadata.contact || customerPhone || null),
                availableBudget: keyInfo.availableBudget,
                keyInfo: {
                    available_budget: keyInfo.availableBudget,
                    customer_id: getOrderContextCustomerId(metadata),
                    phone: normalizeRazorpayContact(metadata.phone || metadata.contact || null),
                    email: normalizeEmail(metadata.email || null)
                },
                completedAt: nowMs()
            });
            return true;
        }
    } catch (_) {
        return false;
    }

    return false;
}

async function enqueueFulfillmentForPayment({
    orderId,
    payment,
    expectedFlow = null,
    topupKeyHint = null,
    emailHint = null,
    contactHint = null
}) {
    const context = await ensureOrderContext(orderId, {
        customerIdHint: payment?.customer_id || null,
        topupKey: topupKeyHint,
        emailHint,
        contactHint
    });
    if (!context) throw new Error('Order context not found');

    const flowType = String(context.flowType || 'paid_checkout');
    if (expectedFlow && flowType !== expectedFlow) {
        throw new Error(`Order flow mismatch: expected ${expectedFlow}, received ${flowType}`);
    }

    let resolvedTopupKey = null;
    if (flowType === 'account_topup') {
        resolvedTopupKey = await resolveTopupKey({
            context,
            payment,
            topupKeyHint
        });
        if (!resolvedTopupKey) {
            throw new Error('Top-up key is missing for this account order');
        }
        if (!context.topupKey || context.topupKey !== resolvedTopupKey) {
            setPendingOrder(orderId, {
                ...context,
                topupKey: resolvedTopupKey
            });
        }
    }

    const existingState = fulfillmentByOrder.get(orderId);
    if (hasProcessedPaymentId(payment.id)) {
        await restoreReadyStateFromArtifacts({
            orderId,
            flowType,
            payment,
            context,
            topupKeyHint: resolvedTopupKey
        });
        return { context, queued: false, flowType };
    }
    if (
        existingState &&
        existingState.status === 'processing' &&
        String(existingState.paymentId || '') === String(payment.id || '')
    ) {
        // State is processing for this payment — it may be a stale in-memory state
        // from a previous server run where the promise already died. Attempt to
        // restore the ready state from Razorpay customer notes before giving up.
        const restored = await restoreReadyStateFromArtifacts({
            orderId,
            flowType,
            payment,
            context,
            topupKeyHint: resolvedTopupKey
        });
        if (restored) {
            logInfo('[fulfillment] restored ready state from artifacts', { orderId, flowType });
        } else {
            logWarn('[fulfillment] processing state persisted but artifact restore failed', { orderId, flowType });
        }
        return { context, queued: false, flowType };
    }

    const customer = await upsertRazorpayCustomerFromPayment(payment, {
        orderId,
        productId: context.productId,
        flowType,
        emailHint: normalizeEmail(emailHint || context.emailHint || payment.email || null),
        contactHint: normalizeRazorpayContact(contactHint || context.contactHint || payment.contact || null),
        customerIdHint: payment.customer_id || context.existingCustomerId || null,
        litellmKeyHint: flowType === 'account_topup' ? resolvedTopupKey : null
    });

    logInfo('[fulfillment] starting', { orderId, flowType, productId: context.productId, paymentId: payment.id, customerId: customer.id });
    markFulfillment(orderId, {
        status: 'processing',
        flowType,
        productId: context.productId,
        paymentId: payment.id,
        customerId: customer.id,
        phone: customer.contact || null
    });

    const onFulfillmentSuccess = () => {
        addProcessedPaymentId(payment.id);
    };

    if (flowType === 'account_topup') {
        logInfo('[account-fulfillment] queued', { orderId, paymentId: payment.id });
        processAccountTopupFulfillment({ orderId, payment, customer })
            .then(() => {
                onFulfillmentSuccess();
                logInfo('[account-fulfillment] completed', { orderId, paymentId: payment.id });
            })
            .catch((err) => {
                logError('[account-fulfillment] failed', err);
                markFulfillment(orderId, {
                    status: 'error',
                    flowType: 'account_topup',
                    message: err.message || 'Fulfillment failed'
                });
            });
        return { context, customer, queued: true, flowType };
    }

    logInfo('[fulfillment] queued', { orderId, paymentId: payment.id, flowType: 'paid_checkout' });
    processPaidFulfillment({ orderId, payment, customer })
        .then(() => {
            onFulfillmentSuccess();
            logInfo('[fulfillment] completed', { orderId, paymentId: payment.id });
        })
        .catch((err) => {
            logError('[fulfillment] failed', err);
            markFulfillment(orderId, {
                status: 'error',
                flowType: 'paid_checkout',
                message: err.message || 'Fulfillment failed'
            });
        });

    return { context, customer, queued: true, flowType };
}

async function recoverAndQueueFulfillment(orderId, options = {}) {
    const payment = await ensureCapturedPayment({
        orderId,
        paymentId: options.paymentId || null
    });
    if (!payment) return null;

    await enqueueFulfillmentForPayment({
        orderId,
        payment,
        expectedFlow: options.expectedFlow || null,
        topupKeyHint: options.topupKeyHint || null,
        emailHint: options.emailHint || null,
        contactHint: options.contactHint || null
    });

    return payment;
}

// ── doWebhookFulfillment — paid_checkout only ──────────────────────────
// Called from the webhook handler (fire-and-forget, response already sent).
// 1. Upsert Razorpay customer from payment details
// 2. Generate LiteLLM key
// 3. Generate plugin zip
// 4. Save key + zipUrl to Razorpay customer notes
// 5. Save to fulfilled-orders.json  ← what check-key reads
async function doWebhookFulfillment(orderId, paymentId) {
    // ── Synchronous lock — must be checked/set BEFORE the first await ──────────
    // Razorpay retries the webhook within milliseconds. fulfilled-orders.json
    // hasn't been written yet when retry #2 arrives, so the file-based dedup
    // check would miss it. The in-memory Set is visible instantly.
    if (fulfillmentInProgress.has(orderId)) {
        logInfo('[webhook-fulfillment] already in-progress (lock held), skipping duplicate', { orderId, paymentId });
        return;
    }
    if (getFulfilledOrder(orderId)) {
        logInfo('[webhook-fulfillment] already fulfilled (file), skipping', { orderId });
        return;
    }
    if (paymentId && hasProcessedPaymentId(paymentId)) {
        logInfo('[webhook-fulfillment] payment already processed, skipping', { orderId, paymentId });
        return;
    }

    fulfillmentInProgress.add(orderId); // ← claim lock (synchronous, before any await)
    logInfo('[webhook-fulfillment] lock acquired, starting', { orderId, paymentId });

    try {

        // ── Ensure payment is captured ─────────────────────────────────
        logInfo('[webhook-fulfillment] checking payment capture status', { orderId, paymentId });
        const payment = await ensureCapturedPayment({ orderId, paymentId });
        if (!payment) {
            logWarn('[webhook-fulfillment] payment not captured yet — Razorpay will retry', { orderId, paymentId });
            return;
        }
        logInfo('[webhook-fulfillment] payment confirmed captured', { orderId, paymentId: payment.id, amount: payment.amount });

        // ── Get product from order notes (stored when /api/checkout created the order) ──
        const context = await ensureOrderContext(orderId, {
            customerIdHint: payment.customer_id || null,
            emailHint: normalizeEmail(payment.email || null),
            contactHint: normalizeRazorpayContact(payment.contact || null)
        });
        if (!context || !context.productId) {
            logError('[webhook-fulfillment] could not resolve product for order', new Error('Product missing'), { orderId });
            return;
        }
        if (context.flowType === 'account_topup') {
            // Account topup — handled by the existing account topup flow, not here
            logInfo('[webhook-fulfillment] account_topup order detected, skipping paid_checkout fulfillment', { orderId });
            return;
        }

        const product = getProductOrThrow(context.productId);
        logInfo('[webhook-fulfillment] product resolved', { orderId, productId: product.id, productName: product.name });

        // ── Upsert Razorpay customer ───────────────────────────────────
        const customer = await upsertRazorpayCustomerFromPayment(payment, {
            orderId,
            productId: product.id,
            flowType: 'paid_checkout',
            emailHint: normalizeEmail(context.emailHint || payment.email || null),
            contactHint: normalizeRazorpayContact(context.contactHint || payment.contact || null),
            customerIdHint: payment.customer_id || context.existingCustomerId || null
        });
        logInfo('[webhook-fulfillment] customer upserted', { orderId, customerId: customer.id });

        // ── Generate LiteLLM key ──────────────────────────────────────
        const plan = getLiteLlmPlanForProduct(product);
        const metadataCustomerIdField = getMetadataCustomerIdField();
        const email = normalizeEmail(customer.email || payment.email || null);
        const phone = normalizeRazorpayContact(customer.contact || payment.contact || null);
        const alias = `paid_${product.id}_${customer.id}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;

        logInfo('[webhook-fulfillment] generating LiteLLM key', { orderId, productId: product.id, alias });
        const keyResp = await litellm.post('/key/generate', {
            key_alias: alias,
            max_budget: plan.key_budget,
            team_id: plan.team_id,
            models: plan.models,
            key_type: plan.key_type,
            metadata: {
                [metadataCustomerIdField]: customer.id,
                razorpay_customer_id: customer.id,
                email: email || '',
                phone: phone || '',
                available_budget: plan.metadata_available_budget,
                product_id: product.id,
                product_name: product.name,
                payment_id: payment.id,
                order_id: orderId,
                flow_type: 'paid_checkout',
                ...plan.metadata
            }
        });

        const key = keyResp.data?.key;
        if (!key) throw new Error('LiteLLM key generation returned no key');
        logInfo('[webhook-fulfillment] LiteLLM key generated', { orderId, keyPrefix: key.slice(0, 8) + '...' });

        // ── Generate plugin zip ───────────────────────────────────────
        const zipUrl = generatePluginZipForKey(key);
        logInfo('[webhook-fulfillment] plugin zip generated', { orderId, zipUrl });

        // ── Save to Razorpay customer notes (recovery artifact) ────────────
        await updateRazorpayCustomerNotes(customer, {
            litellm_key: key,
            plugin_zip_url: zipUrl,
            product_id: product.id,
            product_name: product.name,
            order_id: orderId,
            payment_id: payment.id,
            flow_type: 'paid_checkout'
        });
        logInfo('[webhook-fulfillment] Razorpay customer notes updated', { orderId, customerId: customer.id });

        // ── Write to fulfilled-orders.json – this is what /api/check-key reads ──
        saveFulfilledOrder(orderId, {
            orderId,
            paymentId: payment.id,
            customerId: customer.id,
            key,
            zipUrl,
            phone: phone || null,
            email: email || null,
            productId: product.id
        });
        addProcessedPaymentId(payment.id);

        logInfo('[webhook-fulfillment] ✅ DONE — order fulfilled', { orderId, paymentId: payment.id, zipUrl });
    } catch (err) {
        logError('[webhook-fulfillment] ❌ FAILED', err);
        // Do NOT crash — Razorpay will retry the webhook
    } finally {
        fulfillmentInProgress.delete(orderId); // release lock so retries can try again if it failed
    }
}

async function processAccountTopupFulfillment({ orderId, payment, customer }) {
    const context = pendingOrders.get(orderId);
    if (!context || context.flowType !== 'account_topup') {
        throw new Error('Account top-up context not found');
    }
    if (!context.topupKey) {
        throw new Error('Top-up key is missing');
    }

    const product = getProductOrThrow(context.productId);
    const plan = getLiteLlmPlanForProduct(product);
    const keyInfo = await getLiteLlmKeyInfo(context.topupKey);
    const metadataCustomerIdField = getMetadataCustomerIdField();
    const currentMetadata = keyInfo.metadata || {};
    const availableIncrement = toNumber(plan.metadata_available_budget, 0);
    const keyBudgetIncrement = toNumber(plan.key_budget, 0);
    const currentAvailableBudget = toNumber(currentMetadata.available_budget, 0);
    const nextAvailableBudget = currentAvailableBudget + availableIncrement;
    const phone = normalizeRazorpayContact(customer?.contact || payment?.contact || context.contactHint || null);
    const email = normalizeEmail(customer?.email || payment?.email || context.emailHint || null);

    const updatePayload = {
        key: context.topupKey,
        metadata: {
            ...currentMetadata,
            available_budget: nextAvailableBudget,
            [metadataCustomerIdField]: customer.id,
            razorpay_customer_id: customer.id,
            phone: phone || currentMetadata.phone || currentMetadata.contact || '',
            email: email || currentMetadata.email || '',
            last_topup_order_id: orderId,
            last_topup_payment_id: payment.id,
            last_topup_product_id: product.id,
            last_topup_product_name: product.name,
            flow_type: 'account_topup',
            ...plan.metadata
        }
    };

    if (keyInfo.hasMaxBudget && keyBudgetIncrement > 0) {
        updatePayload.max_budget = Number(keyInfo.maxBudget || 0) + keyBudgetIncrement;
    }

    await litellm.post('/key/update', updatePayload);

    await updateRazorpayCustomerNotes(customer, {
        litellm_key: context.topupKey,
        product_id: product.id,
        product_name: product.name,
        order_id: orderId,
        payment_id: payment.id,
        flow_type: 'account_topup'
    });

    const refreshedInfo = await getLiteLlmKeyInfo(context.topupKey);

    markFulfillment(orderId, {
        status: 'ready',
        flowType: 'account_topup',
        key: context.topupKey,
        customerId: customer.id,
        phone: phone || null,
        availableBudget: refreshedInfo.availableBudget,
        keyInfo: {
            available_budget: refreshedInfo.availableBudget,
            customer_id: getOrderContextCustomerId(refreshedInfo.metadata),
            phone: normalizeRazorpayContact(refreshedInfo.metadata.phone || refreshedInfo.metadata.contact || null),
            email: normalizeEmail(refreshedInfo.metadata.email || null)
        },
        completedAt: nowMs()
    });
}

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

let pluginTemplateFiles = null;

function getPluginTemplateFiles() {
    if (pluginTemplateFiles) return pluginTemplateFiles;

    const templatePath = path.join(ROOT_DIR, runtimeConfig.plugin.template_zip_path);
    const buffer = fs.readFileSync(templatePath);
    pluginTemplateFiles = unzipSync(new Uint8Array(buffer));
    return pluginTemplateFiles;
}

function generatePluginZipForKey(apiKey) {
    const files = getPluginTemplateFiles();
    const placeholder = runtimeConfig.plugin.key_placeholder;
    const output = {};

    for (const [name, data] of Object.entries(files)) {
        const asText = strFromU8(data, true);
        if (asText.includes(placeholder)) {
            output[name] = strToU8(asText.replaceAll(placeholder, apiKey));
        } else {
            output[name] = data;
        }
    }

    const zipped = zipSync(output);
    const filename = `plugin-${crypto.randomUUID()}.zip`;
    fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), zipped);
    return `/downloads/${filename}`;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// ── Razorpay Webhook — MUST be registered BEFORE express.json() ─────────────
// express.json() consumes the body stream for ALL routes globally. If the webhook
// route is registered after it, req.body is already a parsed object (not raw bytes)
// by the time express.raw() runs → the raw body is empty → HMAC fails → 400.
//
// By registering here (before express.json), this route's own express.raw()
// middleware intercepts the body stream first on this specific path.
app.post(RAZORPAY_WEBHOOK_PATH, express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = String(req.headers['x-razorpay-signature'] || '').trim();
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    const bodyType = Buffer.isBuffer(req.body) ? 'Buffer' : typeof req.body;
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const bodyLength = rawBody.length;
    const contentType = req.headers['content-type'] || '(none)';

    logInfo('[razorpay-webhook] incoming request', {
        contentType, bodyType, bodyLength,
        hasSignature: !!signature,
        signaturePrefix: signature ? signature.slice(0, 12) + '...' : '(none)',
        secretConfigured: !!secret
    });

    if (!secret) {
        logError('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not configured');
        return res.status(500).json({ error: 'Webhook secret is not configured' });
    }
    if (!signature) {
        logWarn('[razorpay-webhook] request received without x-razorpay-signature header');
        return res.status(400).json({ error: 'Missing webhook signature' });
    }
    if (bodyLength === 0) {
        logError('[razorpay-webhook] raw body is EMPTY — express.json() may have consumed the stream. Check middleware order.');
        return res.status(400).json({ error: 'Empty body' });
    }

    logDebug('[razorpay-webhook] raw body received', {
        bodyLength,
        bodyPreview: rawBody.slice(0, 80).replace(/\n/g, ' ')
    });

    // ── HMAC verification ────────────────────────────────────────────────────
    const expectedHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    logDebug('[razorpay-webhook] HMAC check', {
        expectedPrefix: expectedHmac.slice(0, 12) + '...',
        receivedPrefix: signature.slice(0, 12) + '...',
        match: expectedHmac === signature
    });

    if (!timingSafeHexEqual(expectedHmac, signature)) {
        logWarn('[razorpay-webhook] signature mismatch', {
            bodyLength, bodyType,
            expectedPrefix: expectedHmac.slice(0, 12) + '...',
            receivedPrefix: signature.slice(0, 12) + '...'
        });
        return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    // ── Parse payload ────────────────────────────────────────────────────────
    let payload = null;
    try {
        payload = JSON.parse(rawBody);
    } catch (_) {
        logWarn('[razorpay-webhook] could not parse payload JSON', { bodyPreview: rawBody.slice(0, 120) });
        return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const event = String(payload?.event || '').trim();
    const paymentEntity = payload?.payload?.payment?.entity || null;
    const orderEntity = payload?.payload?.order?.entity || null;
    const orderId = String(paymentEntity?.order_id || orderEntity?.id || '').trim();
    const paymentId = String(paymentEntity?.id || '').trim() || null;

    logInfo('[razorpay-webhook] event received', { event, orderId, paymentId });

    // ── Ignore unhandled events ──────────────────────────────────────────────
    if (!event || !['payment.captured', 'payment.authorized', 'order.paid'].includes(event)) {
        logDebug('[razorpay-webhook] ignoring event', { event });
        return res.json({ ok: true, ignored: true });
    }
    if (!orderId) {
        logWarn('[razorpay-webhook] no orderId in payload, ignoring', { event });
        return res.json({ ok: true, ignored: true });
    }

    // ── Respond 200 immediately so Razorpay doesn't retry ───────────────────
    // Fulfillment runs in the background. check-key polls fulfilled-orders.json.
    res.json({ ok: true });

    doWebhookFulfillment(orderId, paymentId);
});
// ── End webhook ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '64kb' }));

// ── Video streaming with proper byte-range support ──────────────────────────
// express.static does NOT reliably handle Range requests for large files through
// Cloudflare tunnel (causes "unexpected EOF"). This route pipes a ReadStream
// for exactly the requested byte range, preventing server crashes.
const VIDEOS_DIR = path.join(__dirname, 'public', 'assets', 'videos');

app.get('/assets/videos/:filename', (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const videoPath = path.join(VIDEOS_DIR, filename);

    if (!fs.existsSync(videoPath)) {
        return res.status(404).send('Not found');
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
        // Parse "bytes=start-end"
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1); // 1 MB chunks
        const chunkSize = end - start + 1;

        logDebug('[video] streaming range', { file: filename, start, end, chunkSize, fileSize });

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400'
        });

        const stream = fs.createReadStream(videoPath, { start, end });
        stream.on('error', (err) => {
            logError('[video] stream error', err);
            if (!res.headersSent) res.status(500).end();
            else res.end();
        });
        stream.pipe(res);
    } else {
        // Full file request (e.g. direct download)
        logDebug('[video] full file request', { file: filename, fileSize });
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400'
        });
        const stream = fs.createReadStream(videoPath);
        stream.on('error', (err) => {
            logError('[video] stream error', err);
            res.end();
        });
        stream.pipe(res);
    }
});
// ───────────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));


app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://checkout.razorpay.com',
                'https://www.googletagmanager.com',
                'https://connect.facebook.net',
                'https://www.clarity.ms',
                'https://static.cloudflareinsights.com'
            ],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            styleSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            frameSrc: ["'self'", 'https://checkout.razorpay.com', 'https://api.razorpay.com', 'https:'],
            connectSrc: ["'self'", 'https://api.razorpay.com', 'https:']
        }
    }
}));

app.use(compression());
app.use(morgan('combined', { stream: morganStream }));

function getCheckoutViewData() {
    return {
        products: runtimeConfig.products,
        checkout: runtimeConfig.payment_gateway,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || ''
    };
}

app.get('/', (req, res) => {
    res.render('index', getCheckoutViewData());
});

app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/refund', (req, res) => res.render('refund'));
app.get('/support', (req, res) => res.render('support'));
app.get('/terms', (req, res) => res.render('terms'));

app.get('/account', (req, res) => {
    res.render('account', getCheckoutViewData());
});

app.get('/topup', (req, res) => res.redirect('/account'));

app.post('/api/checkout', async (req, res) => {
    const productId = String(req.body?.productId || '').trim();
    if (!productId) {
        logWarn('[api/checkout] missing productId');
        return res.status(400).json({ error: 'productId is required' });
    }

    const bypass = hasBypassCookie(req);
    if (bypass) logInfo('[api/checkout] bypass cookie detected — order will be ₹1', { productId });

    logInfo('[api/checkout] creating order', { productId, bypass });
    try {
        const { order, product } = await createRazorpayOrderForProduct(productId, { bypass });
        logInfo('[api/checkout] order created', { orderId: order.id, productId, amount: order.amount, bypass });
        return res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: runtimeConfig.payment_gateway
        });
    } catch (err) {
        logError('[api/checkout] failed', err);
        return res.status(500).json({ error: err.message || 'Could not create checkout order' });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();

    if (!paymentId || !orderId || !signature) {
        logWarn('[api/payment/verify] missing fields', { orderId, paymentId: !!paymentId, signature: !!signature });
        return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    logInfo('[api/payment/verify] verifying signature', { orderId, paymentId });
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        logWarn('[api/payment/verify] invalid signature', { orderId, paymentId });
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const payment = await ensureCapturedPayment({ orderId, paymentId });
        if (!payment) {
            logWarn('[api/payment/verify] payment not yet captured', { orderId, paymentId });
            return res.status(400).json({ error: 'Payment not captured. Please wait a few seconds and try again.' });
        }

        logInfo('[api/payment/verify] payment captured, enqueuing fulfillment', { orderId, paymentId });
        await enqueueFulfillmentForPayment({
            orderId,
            payment,
            expectedFlow: 'paid_checkout',
            emailHint: normalizeEmail(payment.email || null),
            contactHint: normalizeRazorpayContact(payment.contact || null)
        });

        logInfo('[api/payment/verify] done — redirecting to success page', { orderId, paymentId });
        return res.json({
            ok: true,
            redirectUrl: `/success?order_id=${encodeURIComponent(orderId)}&payment_id=${encodeURIComponent(payment.id)}`
        });
    } catch (err) {
        logError('[api/payment/verify] failed', err);
        if (String(err.message || '').toLowerCase().includes('flow mismatch')) {
            return res.status(400).json({ error: 'Use /api/account/payment/verify for account top-up orders' });
        }
        markFulfillment(orderId, {
            status: 'error',
            flowType: 'paid_checkout',
            message: err.message || 'Payment verification failed'
        });
        return res.status(500).json({ error: 'Payment verification failed' });
    }
});

app.get('/api/check-key', (req, res) => {
    const orderId = String(req.query.order_id || '').trim();
    if (!orderId) {
        return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    const fulfilled = getFulfilledOrder(orderId);

    if (fulfilled) {
        logInfo('[api/check-key] key ready', { orderId, zipUrl: fulfilled.zipUrl });
        return res.json({
            status: 'ready',
            key: fulfilled.key || null,
            pluginUrl: fulfilled.zipUrl || null
        });
    }

    logDebug('[api/check-key] not yet fulfilled, returning processing', { orderId });
    return res.json({ status: 'processing' });
});

app.post('/api/account/key-info', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) {
        return res.status(400).json({ error: 'LiteLLM key is required' });
    }

    try {
        const keyInfo = await getLiteLlmKeyInfo(key);
        const customerId = getOrderContextCustomerId(keyInfo.metadata);
        const phone = normalizeRazorpayContact(keyInfo.metadata.phone || keyInfo.metadata.contact || null);
        const email = normalizeEmail(keyInfo.metadata.email || null);
        const keyAlias = String(keyInfo.info?.key_alias || keyInfo.info?.key_name || '').trim() || null;

        return res.json({
            ok: true,
            key,
            key_alias: keyAlias,
            available_budget: keyInfo.availableBudget,
            customer_id: customerId,
            phone,
            email
        });
    } catch (err) {
        logError('[api/account/key-info] failed', err);
        return res.status(400).json({ error: 'Invalid LiteLLM key or key info unavailable' });
    }
});

app.post('/api/account/download-zip', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) {
        return res.status(400).json({ error: 'LiteLLM key is required' });
    }

    try {
        const keyInfo = await getLiteLlmKeyInfo(key);
        const customerId = getOrderContextCustomerId(keyInfo.metadata);
        const downloadUrl = generatePluginZipForKey(key);

        if (customerId) {
            await updateRazorpayCustomerNotes({ id: customerId }, {
                litellm_key: key,
                plugin_zip_url: downloadUrl,
                flow_type: 'account_download'
            });
        }

        return res.json({
            ok: true,
            downloadUrl
        });
    } catch (err) {
        logError('[api/account/download-zip] failed', err);
        return res.status(500).json({ error: 'Could not generate plugin zip' });
    }
});

app.post('/api/account/checkout', async (req, res) => {
    const productId = String(req.body?.productId || '').trim();
    const key = String(req.body?.key || '').trim();

    if (!productId) {
        logWarn('[api/account/checkout] missing productId');
        return res.status(400).json({ error: 'productId is required' });
    }
    if (!key) {
        logWarn('[api/account/checkout] missing key');
        return res.status(400).json({ error: 'LiteLLM key is required' });
    }

    logInfo('[api/account/checkout] creating top-up order', { productId });
    try {
        ensureFlowProvidersConfigured();

        const keyInfo = await getLiteLlmKeyInfo(key);
        const metadata = keyInfo.metadata || {};
        const existingCustomerId = getOrderContextCustomerId(metadata);
        const contactHint = normalizeRazorpayContact(metadata.phone || metadata.contact || null);
        const emailHint = normalizeEmail(metadata.email || null);
        const keyHash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

        const { order, product } = await createRazorpayOrderForProduct(productId, {
            flowType: 'account_topup',
            notes: {
                key_hash: keyHash,
                has_customer_id: existingCustomerId ? 'yes' : 'no'
            },
            orderContext: {
                topupKey: key,
                existingCustomerId,
                contactHint,
                emailHint
            }
        });

        logInfo('[api/account/checkout] top-up order created', { orderId: order.id, productId, customerId: existingCustomerId || null });

        if (existingCustomerId) {
            await updateRazorpayCustomerNotes({ id: existingCustomerId }, {
                litellm_key: key,
                flow_type: 'account_topup_pending',
                pending_order_id: order.id
            });
        }

        return res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: runtimeConfig.payment_gateway,
            customerId: existingCustomerId || null,
            prefillContact: contactHint || null
        });
    } catch (err) {
        logError('[api/account/checkout] failed', err);
        return res.status(500).json({ error: err.message || 'Could not create checkout order' });
    }
});

app.post('/api/account/payment/verify', async (req, res) => {
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();
    const topupKeyHint = normalizeLiteLlmKey(req.body?.topup_key || null);

    if (!paymentId || !orderId || !signature) {
        logWarn('[api/account/payment/verify] missing fields', { orderId, paymentId: !!paymentId, signature: !!signature });
        return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    logInfo('[api/account/payment/verify] verifying signature', { orderId, paymentId });
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        logWarn('[api/account/payment/verify] invalid signature', { orderId, paymentId });
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const payment = await ensureCapturedPayment({ orderId, paymentId });
        if (!payment) {
            logWarn('[api/account/payment/verify] payment not yet captured', { orderId, paymentId });
            return res.status(400).json({
                error: 'Payment not captured. Please wait a few seconds and try again.'
            });
        }

        logInfo('[api/account/payment/verify] payment captured, enqueuing topup fulfillment', { orderId, paymentId, hasTopupKey: !!topupKeyHint });
        await enqueueFulfillmentForPayment({
            orderId,
            payment,
            expectedFlow: 'account_topup',
            topupKeyHint
        });

        logInfo('[api/account/payment/verify] done', { orderId, paymentId });
        return res.json({
            ok: true,
            orderId,
            paymentId: payment.id
        });
    } catch (err) {
        logError('[api/account/payment/verify] failed', err);
        if (String(err.message || '').toLowerCase().includes('flow mismatch')) {
            return res.status(400).json({ error: 'This order is not an account top-up order' });
        }
        if (String(err.message || '').toLowerCase().includes('top-up key is missing')) {
            return res.status(400).json({ error: 'Top-up key is missing. Reload account and retry payment verification.' });
        }
        markFulfillment(orderId, {
            status: 'error',
            flowType: 'account_topup',
            message: err.message || 'Payment verification failed'
        });
        return res.status(500).json({ error: 'Payment verification failed' });
    }
});

app.get('/api/account/payment-status', async (req, res) => {
    const orderId = String(req.query.order_id || '').trim();
    const topupKeyHint = normalizeLiteLlmKey(req.headers['x-topup-key'] || null);
    if (!orderId) {
        return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    let state = fulfillmentByOrder.get(orderId);
    if (!state || state.status === 'awaiting_payment' || state.status === 'processing') {
        logInfo('[api/account/payment-status] triggering recovery', { orderId, prevStatus: state?.status || 'none' });
        try {
            await recoverAndQueueFulfillment(orderId, {
                expectedFlow: 'account_topup',
                topupKeyHint
            });
        } catch (err) {
            logError('[api/account/payment-status] recovery failed', err);
        }
        state = fulfillmentByOrder.get(orderId);
        logDebug('[api/account/payment-status] state after recovery', { orderId, status: state?.status || 'none' });
    }

    if (!state) {
        return res.json({ status: 'processing' });
    }
    if (state.flowType && state.flowType !== 'account_topup') {
        return res.json({ status: 'processing' });
    }

    if (state.status === 'error') {
        return res.status(500).json({ status: 'error', message: state.message || 'Fulfillment failed' });
    }

    if (state.status === 'ready') {
        return res.json({
            status: 'ready',
            key: state.key || null,
            keyInfo: state.keyInfo || {
                available_budget: toNumber(state.availableBudget, 0),
                customer_id: state.customerId || null,
                phone: state.phone || null,
                email: null
            }
        });
    }

    return res.json({ status: 'processing' });
});

app.get('/success', (req, res) => {
    const orderId = String(req.query.order_id || '').trim();
    const paymentId = String(req.query.payment_id || '').trim() || null;

    if (!orderId) {
        logWarn('[/success] accessed without order_id, redirecting home');
        return res.redirect('/');
    }

    logInfo('[/success] rendering success page', { orderId, paymentId });
    const context = pendingOrders.get(orderId) || {};
    const state = fulfillmentByOrder.get(orderId) || {};
    const amount = context.amountPaise ? (context.amountPaise / 100).toFixed(2) : null;
    const currency = context.currency || runtimeConfig.payment_gateway.currency || 'INR';

    res.render('success', {
        order_id: orderId,
        payment_id: paymentId,
        orderDetails: {
            order_id: orderId,
            payment_id: paymentId || state.paymentId || null,
            phone: state.phone || null,
            customer_id: state.customerId || null,
            amount,
            currency
        }
    });
});

app.post('/api/free-download', async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const phone = normalizeIndianPhone(req.body?.phone);
    const hasValidEmail = !!email && isValidEmail(email);
    const hasValidPhone = !!phone && isValidPhone(phone);

    if (!hasValidEmail && !hasValidPhone) {
        logWarn('[api/free-download] invalid or missing contact', { email: !!email, phone: !!phone });
        return res.status(400).json({ error: 'Provide a valid email or Indian phone number' });
    }

    logInfo('[api/free-download] request received', { via: hasValidEmail ? 'email' : 'phone' });
    try {
        ensureFlowProvidersConfigured();

        const customer = hasValidEmail
            ? await upsertRazorpayCustomerByEmail(email)
            : await upsertRazorpayCustomerByContact(phone);

        logDebug('[api/free-download] customer upserted', { customerId: customer.id });

        const key = await createFreeLiteLlmKey({
            email: hasValidEmail ? email : null,
            phone: hasValidPhone ? phone : null,
            razorpayCustomerId: customer.id
        });
        const downloadUrl = generatePluginZipForKey(key);

        const notesPatch = {
            litellm_key: key,
            plugin_zip_url: downloadUrl,
            flow_type: 'free_download'
        };
        if (hasValidEmail) notesPatch.email = email;
        if (hasValidPhone) notesPatch.phone = phone;

        await updateRazorpayCustomerNotes(customer, notesPatch);

        logInfo('[api/free-download] plugin zip generated', { customerId: customer.id, downloadUrl });
        return res.json({
            ok: true,
            downloadUrl
        });
    } catch (err) {
        logError('[api/free-download] failed', err);
        return res.status(500).json({
            error: 'Could not prepare your free download. Please try again.'
        });
    }
});




app.get('/health', (req, res) => res.send('OK'));

// \u2500\u2500 Bypass route \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// GET /api/bypass?code=<BYPASS_CODE>&action=add|remove
// Sets / clears a server-only httpOnly cookie that makes /api/checkout
// create a \u20b91 Razorpay order instead of the real price.
// Code is validated against process.env.BYPASS_CODE.
// No frontend changes required \u2014 Razorpay popup still opens normally.
app.get('/api/bypass', (req, res) => {
    const code = String(req.query.code || '').trim();
    const action = String(req.query.action || '').trim();
    const envCode = String(process.env.BYPASS_CODE || '').trim();

    if (!envCode) {
        logWarn('[api/bypass] BYPASS_CODE env var is not set');
        return res.status(503).json({ error: 'Bypass is not configured on this server' });
    }

    // Constant-time comparison to prevent timing attacks
    const codeBuffer = Buffer.from(code.padEnd(64));
    const envBuffer = Buffer.from(envCode.padEnd(64));
    let mismatch = false;
    try {
        mismatch = !crypto.timingSafeEqual(codeBuffer, envBuffer);
    } catch (_) {
        mismatch = true;
    }
    if (!code || mismatch) {
        logWarn('[api/bypass] invalid bypass code attempt', { ip: req.ip });
        return res.status(403).json({ error: 'Invalid bypass code' });
    }

    if (action !== 'add' && action !== 'remove') {
        return res.status(400).json({ error: 'action must be "add" or "remove"' });
    }

    const cookieOptions = {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/'
    };

    if (action === 'add') {
        res.cookie(BYPASS_COOKIE_NAME, '1', {
            ...cookieOptions,
            maxAge: 3 * 60 * 60 * 1000  // 3 hours
        });
        logInfo('[api/bypass] bypass cookie SET', { ip: req.ip });
        return res.json({ ok: true, action: 'added', message: 'Bypass enabled. Payments will be \u20b91.' });
    }

    // action === 'remove'
    res.clearCookie(BYPASS_COOKIE_NAME, cookieOptions);
    logInfo('[api/bypass] bypass cookie CLEARED', { ip: req.ip });
    return res.json({ ok: true, action: 'removed', message: 'Bypass disabled. Normal pricing restored.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logInfo('Server started', {
        mode: 'PRODUCTION',
        port: PORT,
        url: `http://localhost:${PORT}`,
        logFile: 'app_debug.log'
    });
});

// ── Graceful shutdown ─────────────────────────────────────────────────
function shutdown(signal) {
    logInfo(`[process] received ${signal} — persisting state and exiting`);
    persistOrderStateNow();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
