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
            products: toProductsArray(parsed.products)
        };
    } catch (err) {
        console.warn('[server] Could not parse payment-config.json, using defaults:', err.message);
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
const productsById = new Map(runtimeConfig.products.map((p) => [p.id, p]));

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
const ORDER_STATE_TTL_MS = 24 * 60 * 60 * 1000;

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
    const sigB = Buffer.from(String(signature || ''), 'utf8');
    if (sigA.length !== sigB.length) return false;
    return crypto.timingSafeEqual(sigA, sigB);
}

function normalizeEmail(email) {
    if (!email) return null;
    const value = String(email).trim().toLowerCase();
    return value || null;
}

function normalizePhone(phone) {
    if (!phone) return null;
    const value = String(phone).replace(/[^\d]/g, '').trim();
    return value || null;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function extractCustomerItems(payload) {
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
}

async function findRazorpayCustomerByEmail(email) {
    const response = await razorpay.get('/customers', { params: { count: 100, skip: 0 } });
    const items = extractCustomerItems(response.data);
    return items.find((item) => normalizeEmail(item.email) === normalizeEmail(email)) || null;
}

async function findRazorpayCustomerByContact(contact) {
    const response = await razorpay.get('/customers', { params: { count: 100, skip: 0 } });
    const items = extractCustomerItems(response.data);
    return items.find((item) => normalizePhone(item.contact) === normalizePhone(contact)) || null;
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

async function updateRazorpayCustomerNotes(customer, notesPatch) {
    let current = customer;
    if (current && current.id && (!current.name || typeof current.notes === 'undefined')) {
        try {
            const fetched = await razorpay.get(`/customers/${encodeURIComponent(current.id)}`);
            current = fetched.data;
        } catch (err) {
            // use provided payload as fallback
        }
    }

    const mergedNotes = {
        ...((current && current.notes) || {}),
        ...(notesPatch || {})
    };

    await razorpay.put(`/customers/${encodeURIComponent(current.id)}`, {
        name: current.name || `customer_${Date.now()}`,
        email: current.email || undefined,
        contact: current.contact || undefined,
        notes: mergedNotes,
        fail_existing: '0'
    });
}

async function upsertRazorpayCustomerFromPayment(payment, orderContext) {
    const email = normalizeEmail(payment.email || orderContext?.emailHint || null);
    const contact = normalizePhone(payment.contact || orderContext?.contactHint || null);
    const customerId = payment.customer_id || orderContext?.customerIdHint || null;
    const flowType = String(orderContext?.flowType || 'paid_checkout');

    if (customerId) {
        try {
            const existing = await razorpay.get(`/customers/${encodeURIComponent(customerId)}`);
            const customer = existing.data;
            await razorpay.put(`/customers/${encodeURIComponent(customerId)}`, {
                name: customer.name || `customer_${contact || email || customerId}`,
                email: email || customer.email || undefined,
                contact: contact || customer.contact || undefined,
                notes: {
                    ...(customer.notes || {}),
                    flow_type: flowType,
                    product_id: orderContext?.productId || '',
                    last_order_id: orderContext?.orderId || '',
                    last_payment_id: payment.id || ''
                },
                fail_existing: '0'
            });
            return {
                id: customerId,
                email: email || customer.email || null,
                contact: contact || customer.contact || null
            };
        } catch (err) {
            // fall through to create/find by email/contact
        }
    }

    let existing = null;
    if (email) existing = await findRazorpayCustomerByEmail(email);
    if (!existing && contact) existing = await findRazorpayCustomerByContact(contact);

    if (existing) {
        await razorpay.put(`/customers/${encodeURIComponent(existing.id)}`, {
            name: existing.name || `customer_${contact || email || existing.id}`,
            email: email || existing.email || undefined,
            contact: contact || existing.contact || undefined,
            notes: {
                ...(existing.notes || {}),
                flow_type: flowType,
                product_id: orderContext?.productId || '',
                last_order_id: orderContext?.orderId || '',
                last_payment_id: payment.id || ''
            },
            fail_existing: '0'
        });
        return {
            id: existing.id,
            email: email || existing.email || null,
            contact: contact || existing.contact || null
        };
    }

    const createResp = await razorpay.post('/customers', {
        name: `customer_${contact || (email || 'guest').split('@')[0]}`,
        email: email || undefined,
        contact: contact || undefined,
        notes: {
            flow_type: flowType,
            product_id: orderContext?.productId || '',
            last_order_id: orderContext?.orderId || '',
            last_payment_id: payment.id || ''
        },
        fail_existing: '0'
    });

    return {
        id: createResp.data.id,
        email: email || createResp.data.email || null,
        contact: contact || createResp.data.contact || null
    };
}

async function createFreeLiteLlmKey({ email, razorpayCustomerId }) {
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
            email,
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
    const amountPaise = Math.round(toNumber(product.amount_inr, 0) * 100);
    if (!amountPaise) throw new Error(`Invalid amount configured for product "${product.id}"`);
    const flowType = String(options.flowType || 'paid_checkout');
    const notes = {
        flow_type: flowType,
        product_id: product.id,
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
    pendingOrders.set(order.id, {
        orderId: order.id,
        productId: product.id,
        amountPaise,
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

async function processPaidFulfillment({ orderId, payment, customer }) {
    const context = pendingOrders.get(orderId);
    if (!context) throw new Error('Order context not found');
    const product = getProductOrThrow(context.productId);
    const plan = getLiteLlmPlanForProduct(product);
    const metadataCustomerIdField =
        runtimeConfig.litellm_key_details.metadata_customer_id_field ||
        runtimeConfig.free_download.metadata_customer_id_field ||
        'razorpay_customer_id';
    const email = normalizeEmail(customer?.email || payment?.email || null);
    const contact = normalizePhone(customer?.contact || payment?.contact || null);

    markFulfillment(orderId, {
        status: 'processing',
        productId: product.id,
        paymentId: payment.id,
        customerId: customer.id,
        phone: contact
    });

    const alias = `paid_${product.id}_${customer.id}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
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
            phone: contact || '',
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
    if (!key) throw new Error('LiteLLM key generation failed');

    const downloadUrl = generatePluginZipForKey(key);
    await updateRazorpayCustomerNotes(customer, {
        litellm_key: key,
        plugin_zip_url: downloadUrl,
        product_id: product.id,
        product_name: product.name,
        order_id: orderId,
        payment_id: payment.id,
        flow_type: 'paid_checkout'
    });

    markFulfillment(orderId, {
        status: 'ready',
        key,
        pluginUrl: downloadUrl,
        completedAt: nowMs()
    });
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
    const phone = normalizePhone(customer?.contact || payment?.contact || context.contactHint || null);
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
            phone: normalizePhone(refreshedInfo.metadata.phone || refreshedInfo.metadata.contact || null),
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

app.use(express.json({ limit: '64kb' }));
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
                'https://www.clarity.ms'
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
app.use(morgan('combined'));

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
        return res.status(400).json({ error: 'productId is required' });
    }

    try {
        const { order, product } = await createRazorpayOrderForProduct(productId);
        return res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: runtimeConfig.payment_gateway
        });
    } catch (err) {
        console.error('[api/checkout] failed:', err.message);
        return res.status(500).json({ error: err.message || 'Could not create checkout order' });
    }
});

app.post('/api/payment/verify', async (req, res) => {
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();

    if (!paymentId || !orderId || !signature) {
        return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const context = pendingOrders.get(orderId);
    if (!context) {
        return res.status(404).json({ error: 'Order not found or expired' });
    }
    if (context.flowType === 'account_topup') {
        return res.status(400).json({ error: 'Use /api/account/payment/verify for account top-up orders' });
    }

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const paymentResp = await razorpay.get(`/payments/${encodeURIComponent(paymentId)}`);
        let payment = paymentResp.data;
        payment = await capturePaymentIfNeeded(payment);

        if (!payment || payment.status !== 'captured') {
            return res.status(400).json({ error: `Payment not captured. Current status: ${payment?.status || 'unknown'}` });
        }

        const customer = await upsertRazorpayCustomerFromPayment(payment, {
            orderId,
            productId: context.productId,
            flowType: context.flowType || 'paid_checkout',
            emailHint: normalizeEmail(payment.email || null),
            contactHint: normalizePhone(payment.contact || null),
            customerIdHint: payment.customer_id || null
        });

        markFulfillment(orderId, {
            status: 'processing',
            paymentId: payment.id,
            customerId: customer.id,
            phone: customer.contact || null
        });

        if (!processedPaymentIds.has(payment.id)) {
            processedPaymentIds.add(payment.id);
            processPaidFulfillment({ orderId, payment, customer }).catch((err) => {
                console.error('[fulfillment] failed:', err.message);
                markFulfillment(orderId, {
                    status: 'error',
                    message: err.message || 'Fulfillment failed'
                });
            });
        }

        return res.json({
            ok: true,
            redirectUrl: `/success?order_id=${encodeURIComponent(orderId)}&payment_id=${encodeURIComponent(payment.id)}`
        });
    } catch (err) {
        console.error('[api/payment/verify] failed:', err.message);
        markFulfillment(orderId, {
            status: 'error',
            message: err.message || 'Payment verification failed'
        });
        return res.status(500).json({ error: 'Payment verification failed' });
    }
});

app.get('/api/check-key', async (req, res) => {
    const orderId = String(req.query.order_id || '').trim();
    if (!orderId) {
        return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

    const state = fulfillmentByOrder.get(orderId);
    if (!state) {
        return res.json({ status: 'processing' });
    }
    if (state.flowType && state.flowType !== 'account_topup') {
        return res.status(400).json({ status: 'error', message: 'Order is not an account top-up order' });
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

app.post('/api/account/key-info', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) {
        return res.status(400).json({ error: 'LiteLLM key is required' });
    }

    try {
        const keyInfo = await getLiteLlmKeyInfo(key);
        const customerId = getOrderContextCustomerId(keyInfo.metadata);
        const phone = normalizePhone(keyInfo.metadata.phone || keyInfo.metadata.contact || null);
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
        console.error('[api/account/key-info] failed:', err.message);
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
        console.error('[api/account/download-zip] failed:', err.message);
        return res.status(500).json({ error: 'Could not generate plugin zip' });
    }
});

app.post('/api/account/checkout', async (req, res) => {
    const productId = String(req.body?.productId || '').trim();
    const key = String(req.body?.key || '').trim();

    if (!productId) {
        return res.status(400).json({ error: 'productId is required' });
    }
    if (!key) {
        return res.status(400).json({ error: 'LiteLLM key is required' });
    }

    try {
        ensureFlowProvidersConfigured();

        const keyInfo = await getLiteLlmKeyInfo(key);
        const metadata = keyInfo.metadata || {};
        const existingCustomerId = getOrderContextCustomerId(metadata);
        const contactHint = normalizePhone(metadata.phone || metadata.contact || null);
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

        return res.json({
            order,
            product,
            razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
            checkout: runtimeConfig.payment_gateway,
            customerId: existingCustomerId || null,
            prefillContact: contactHint || null
        });
    } catch (err) {
        console.error('[api/account/checkout] failed:', err.message);
        return res.status(500).json({ error: err.message || 'Could not create checkout order' });
    }
});

app.post('/api/account/payment/verify', async (req, res) => {
    const paymentId = String(req.body?.razorpay_payment_id || '').trim();
    const orderId = String(req.body?.razorpay_order_id || '').trim();
    const signature = String(req.body?.razorpay_signature || '').trim();

    if (!paymentId || !orderId || !signature) {
        return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    const context = pendingOrders.get(orderId);
    if (!context) {
        return res.status(404).json({ error: 'Order not found or expired' });
    }
    if (context.flowType !== 'account_topup') {
        return res.status(400).json({ error: 'This order is not an account top-up order' });
    }
    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
        return res.status(400).json({ error: 'Invalid payment signature' });
    }

    try {
        const paymentResp = await razorpay.get(`/payments/${encodeURIComponent(paymentId)}`);
        let payment = paymentResp.data;
        payment = await capturePaymentIfNeeded(payment);

        if (!payment || payment.status !== 'captured') {
            return res.status(400).json({
                error: `Payment not captured. Current status: ${payment?.status || 'unknown'}`
            });
        }

        const customer = await upsertRazorpayCustomerFromPayment(payment, {
            orderId,
            productId: context.productId,
            flowType: 'account_topup',
            emailHint: context.emailHint || null,
            contactHint: context.contactHint || null,
            customerIdHint: context.existingCustomerId || payment.customer_id || null
        });

        markFulfillment(orderId, {
            status: 'processing',
            flowType: 'account_topup',
            paymentId: payment.id,
            customerId: customer.id,
            phone: customer.contact || null
        });

        if (!processedPaymentIds.has(payment.id)) {
            processedPaymentIds.add(payment.id);
            processAccountTopupFulfillment({ orderId, payment, customer }).catch((err) => {
                console.error('[account-fulfillment] failed:', err.message);
                markFulfillment(orderId, {
                    status: 'error',
                    flowType: 'account_topup',
                    message: err.message || 'Fulfillment failed'
                });
            });
        }

        return res.json({
            ok: true,
            orderId,
            paymentId: payment.id
        });
    } catch (err) {
        console.error('[api/account/payment/verify] failed:', err.message);
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
    if (!orderId) {
        return res.status(400).json({ status: 'error', message: 'Missing order_id' });
    }

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
        return res.redirect('/');
    }

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
    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'A valid email is required' });
    }

    try {
        ensureFlowProvidersConfigured();

        const customer = await upsertRazorpayCustomerByEmail(email);
        const key = await createFreeLiteLlmKey({
            email,
            razorpayCustomerId: customer.id
        });
        const downloadUrl = generatePluginZipForKey(key);

        await updateRazorpayCustomerNotes(customer, {
            litellm_key: key,
            plugin_zip_url: downloadUrl,
            email,
            flow_type: 'free_download'
        });

        return res.json({
            ok: true,
            downloadUrl
        });
    } catch (err) {
        console.error('[api/free-download] failed:', err.message);
        return res.status(500).json({
            error: 'Could not prepare your free download. Please try again.'
        });
    }
});

app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('\nServer is running');
    console.log('Mode: PRODUCTION');
    console.log(`Local URL: http://localhost:${PORT}`);
});
