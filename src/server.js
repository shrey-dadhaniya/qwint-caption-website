require('dotenv').config(); // ⚠️ Must be first — loads .env before any other module reads process.env

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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

// --- CONFIGURATION ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (includes /downloads/ for generated plugin zips)
app.use(express.static(path.join(__dirname, 'public')));

// --- MIDDLEWARE ---
// Security headers (relaxed slightly in dev for CDN/Tailwind)
app.use(helmet({
    contentSecurityPolicy: isDev ? false : {
        directives: {
            "default-src": ["'self'"],
            "script-src": [
                "'self'", "'unsafe-inline'",
                "https://js.stripe.com",
                "https://connect.facebook.net",
                "https://www.googletagmanager.com",
                "https://www.clarity.ms"
            ],
            "script-src-attr": ["'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "style-src-attr": ["'unsafe-inline'"],
            "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
            "img-src": [
                "'self'", "data:",
                "https://images.stripe.com",
                "https://www.facebook.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com",
                "https://www.googletagmanager.com",
                "https://*.clarity.ms",
                "https://c.clarity.ms"
            ],
            "frame-src": ["https://js.stripe.com", "https://buy.stripe.com"],
            "connect-src": [
                "'self'",
                "https://www.facebook.com",
                "https://www.google-analytics.com",
                "https://*.google-analytics.com",
                "https://*.analytics.google.com",
                "https://*.clarity.ms",
                "https://w.clarity.ms"
            ],
        },
    },
}));

app.use(compression()); // Compress responses
app.use(morgan(isDev ? 'dev' : 'combined')); // Logging

// Rate Limiter to prevent API abuse
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { status: 'error', message: 'Too many requests' }
});

const litellm = axios.create({
    baseURL: process.env.LITELLM_URL,
    headers: { 'x-litellm-api-key': process.env.LITELLM_MASTER_KEY }
});

// --- PLUGIN ZIP GENERATOR ---
// Paths
const PLUGIN_TEMPLATE_PATH = path.join(__dirname, 'private', 'plugin.zip');
const DOWNLOADS_DIR = path.join(__dirname, 'public', 'downloads');
const PLACEHOLDER = 'PROD_CUSTOMER_API_KEY';

// Ensure downloads directory exists
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Pre-load + parse the template ZIP once at startup — avoids disk reads per request.
// At 1000 users/hr this means ~0 I/O cost per generation (only writes, never reads).
let templateFiles = null;
try {
    const buf = fs.readFileSync(PLUGIN_TEMPLATE_PATH);
    templateFiles = unzipSync(new Uint8Array(buf));
    console.log(`[plugin] Template loaded: ${Object.keys(templateFiles).length} entries from ${path.basename(PLUGIN_TEMPLATE_PATH)}`);
} catch (e) {
    console.warn(`[plugin] WARNING: Could not load plugin template — ${e.message}`);
    console.warn(`[plugin] Place your zip at: ${PLUGIN_TEMPLATE_PATH}`);
}

/**
 * generatePlugin(apiKey)
 * Replaces PROD_CUSTOMER_API_KEY in all text entries of the template zip,
 * writes a new uniquely-named zip to /public/downloads/, returns the filename.
 * Binary entries are left byte-for-byte identical.
 *
 * Performance: ~pure memory ops. ~0.5–2ms per call. Safe at 1000 req/hr.
 */
function generatePlugin(apiKey) {
    if (!templateFiles) throw new Error('Plugin template not loaded');

    const out = {};
    for (const [name, data] of Object.entries(templateFiles)) {
        // Try UTF-8 decode; skip (keep binary) if it contains the placeholder
        const str = strFromU8(data, true); // true = lenient (won't throw on bad bytes)
        if (str.includes(PLACEHOLDER)) {
            out[name] = strToU8(str.replaceAll(PLACEHOLDER, apiKey));
        } else {
            out[name] = data; // binary or text without placeholder — untouched
        }
    }

    const zipped = zipSync(out);
    const filename = `plugin-${crypto.randomUUID()}.zip`;
    fs.writeFileSync(path.join(DOWNLOADS_DIR, filename), zipped);
    return filename;
}

// --- STRIPE METADATA PARSER ---
/**
 * Stripe metadata values are always plain strings.
 * This helper converts them to proper JS types so the rest
 * of the app never has to deal with raw string coercion.
 *
 * @param {Object} priceMeta   - price.metadata   (string→string map)
 * @param {Object} productMeta - product.metadata  (string→string map)
 * @returns {Object} Fully typed configuration object
 */
function parseStripeMeta(priceMeta = {}, productMeta = {}) {
    // Helper: try JSON.parse first, fall back to comma-split, then empty array
    const toArray = (raw) => {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch (_) { /* not valid JSON — fall through */ }
        return raw.split(',').map(s => s.trim()).filter(Boolean);
    };

    return {
        // ── Price-level fields ──────────────────────────────────────────
        key_budget: parseFloat(priceMeta.key_budget ?? '10'),
        key_metadata_available_budget: parseFloat(priceMeta.key_metadata_available_budget ?? '10'),

        // ── Product-level fields ────────────────────────────────────────
        team_id: (productMeta.team_id ?? 'default').trim(),
        models: toArray(productMeta.models),           // always string[]
        key_type: (productMeta.key_type ?? 'llm_api').trim(),
    };
}

// --- ROUTES ---

/**
 * Home Page — lists all active Stripe products
 */
app.get('/', (req, res) => {
    res.render('index', {
        stripePricingTableId: process.env.STRIPE_PRICING_TABLE_ID || '',
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        paymentLinkIdStarter: process.env.PAYMENT_LINK_STARTER_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdLite: process.env.PAYMENT_LINK_LITE_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdCreator: process.env.PAYMENT_LINK_CREATOR_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdStudio: process.env.PAYMENT_LINK_STUDIO_ID || process.env.PAYMENT_LINK_ID || '',
    });
});

app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/refund', (req, res) => res.render('refund'));
app.get('/support', (req, res) => res.render('support'));
app.get('/terms', (req, res) => res.render('terms'));

app.get('/topup', (req, res) => {
    res.render('topup', {
        paymentLinkIdStarter: process.env.PAYMENT_LINK_STARTER_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdLite: process.env.PAYMENT_LINK_LITE_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdCreator: process.env.PAYMENT_LINK_CREATOR_ID || process.env.PAYMENT_LINK_ID || '',
        paymentLinkIdStudio: process.env.PAYMENT_LINK_STUDIO_ID || process.env.PAYMENT_LINK_ID || '',
    });
});
app.get('/topup-success', (req, res) => res.render('topup-success'));

/**
 * API: Fetch all active products with their first price
 */
app.get('/api/products', async (req, res) => {
    try {
        const prices = await stripe.prices.list({
            active: true,
            expand: ['data.product'],
            limit: 12,
        });

        // Filter out archived/inactive products and pair each price with its product
        const products = prices.data
            .filter(p => p.product && p.product.active)
            .map(p => ({ price: p, product: p.product }));

        res.json({ products });
    } catch (e) {
        console.error('Products fetch error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

async function createCheckoutSession(paymentLinkId, existingStripeCustomerId = null) {
    logInfo(`creating checkout session. paymentLinkId: ${paymentLinkId}, existingId: ${existingStripeCustomerId}`);
    try {
        const paymentLink = await stripe.paymentLinks.retrieve(
            paymentLinkId,
            { expand: ['line_items'] }
        );

        const lineItems = paymentLink.line_items.data.map(item => ({
            price: item.price.id,
            quantity: item.quantity,
        }));

        const sessionConfig = {
            line_items: lineItems,
            mode: 'payment',
            billing_address_collection: 'required',
            submit_type: 'pay',
            allow_promotion_codes: true,
            payment_intent_data: { setup_future_usage: 'on_session' },
            success_url: existingStripeCustomerId ? `${process.env.BASE_URL}/topup-success` : `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: existingStripeCustomerId ? `${process.env.BASE_URL}/topup` : `${process.env.BASE_URL}/`,
            metadata: { flow_type: existingStripeCustomerId ? 'top_up' : 'initial_buy' },
        };

        if (existingStripeCustomerId) {
            sessionConfig.customer = existingStripeCustomerId;
        } else {
            sessionConfig.customer_creation = 'always';
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);
        logInfo(`checkout session created`, { id: session.id, url: session.url });
        return session.url;
    } catch (error) {
        logError("Stripe Session Error", error);
        throw error;
    }
}

/**
 * API: Create Stripe Checkout Session and return URL
 */
app.post('/api/checkout', express.json(), async (req, res) => {
    const { paymentLinkId } = req.body;
    logInfo('/api/checkout called', { paymentLinkId });
    if (!paymentLinkId) return res.status(400).json({ error: 'paymentLinkId is required' });

    try {
        const url = await createCheckoutSession(paymentLinkId, null);
        res.json({ url });
    } catch (e) {
        logError('Checkout error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * API: Fetch info for topup by email or litellm key
 */
app.post('/api/topup-info', express.json(), async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    let q = query.trim();

    try {
        let stripeId = null;
        let customerEmail = null;
        let existingKey = null;

        try {
            const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(q)}`);
            const metadata = keyInfoResp.data?.metadata || keyInfoResp.data?.info?.metadata || {};
            stripeId = metadata.stripe_id;
            existingKey = q;
            if (!stripeId) {
                return res.status(404).json({ error: 'Key not associated with a Stripe customer.' });
            }
            const customer = await stripe.customers.retrieve(stripeId);
            customerEmail = customer.email;
        } catch (err) {
            return res.status(404).json({ error: 'Invalid LiteLLM key or not found.' });
        }

        if (!existingKey) {
            return res.status(404).json({ error: 'Account found, but no LiteLLM key is associated with it.' });
        }

        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(existingKey)}`);
        const metadata = keyInfoResp.data?.metadata || keyInfoResp.data?.info?.metadata || {};
        const availableBudget = metadata.available_budget || 0;

        res.json({
            stripeId,
            email: customerEmail,
            key: existingKey,
            available_budget: availableBudget
        });
    } catch (e) {
        console.error('[topup-info] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * API: Generate and return a personalized plugin zip
 */
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


/**
 * API: Create Topup Checkout Session
 */
app.post('/api/checkout-topup', express.json(), async (req, res) => {
    const { paymentLinkId, customerId } = req.body;
    logInfo('/api/checkout-topup called', { paymentLinkId, customerId });
    if (!paymentLinkId || !customerId) return res.status(400).json({ error: 'paymentLinkId and customerId are required' });

    try {
        const url = await createCheckoutSession(paymentLinkId, customerId);
        res.json({ url });
    } catch (e) {
        logError('Checkout top-up error:', e);
        res.status(500).json({ error: e.message });
    }
});

/**
 * 1. Webhook: The Engine
 * Background process to create/update keys.
 */
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        logError('Webhook signature verification failed', err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logInfo(`Webhook received: ${event.type}`);

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        logInfo(`checkout.session.completed data`, session);
        let stripeId = session.customer;
        const flowType = session.metadata?.flow_type || 'initial_buy';

        try {
            if (!stripeId) {
                const email = session.customer_details?.email;
                if (!email) throw new Error('No customer ID and no email in session.');

                const existingCustomers = await stripe.customers.list({ email, limit: 1 });
                if (existingCustomers.data.length > 0) {
                    stripeId = existingCustomers.data[0].id;
                    logInfo(`Mapped guest to existing customer`, { stripeId, email });
                } else {
                    throw new Error(`[webhook] No matching guest customer found in Stripe for email: ${email}`);
                }
            }
            // Resolve quota from the purchased price's metadata
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
            const priceId = lineItems.data[0]?.price?.id;
            logInfo(`Line items retrieved`, { priceId });

            // Retrieve price AND expand the product so we can read product-level metadata
            const price = priceId
                ? await stripe.prices.retrieve(priceId, { expand: ['product'] })
                : null;

            // Parse ALL stripe metadata into properly typed fields via central helper
            const meta = parseStripeMeta(
                price?.metadata ?? {},
                price?.product?.metadata ?? {}
            );
            const keyAlias = `${meta.team_id}_${stripeId}`;

            logInfo('[webhook] meta parsed', { flowType, priceId, keyAlias, meta });

            const customer = await stripe.customers.retrieve(stripeId);
            const existingKey = customer.metadata.litellm_key;

            if (!existingKey) {
                logInfo(`Creating new key for customer`, { stripeId });
                const resp = await litellm.post('/key/generate', {
                    key_alias: keyAlias,
                    max_budget: meta.key_budget,
                    team_id: meta.team_id,
                    models: meta.models,
                    key_type: meta.key_type,
                    metadata: {
                        stripe_id: stripeId,
                        email: session.customer_details.email,
                        available_budget: meta.key_metadata_available_budget
                    }
                });
                const generatedKey = resp.data.key;

                // Generate personalised plugin zip with the customer's API key baked in
                let pluginZipUrl = null;
                try {
                    const filename = generatePlugin(generatedKey);
                    pluginZipUrl = `${process.env.BASE_URL}/downloads/${filename}`;
                    logInfo(`Plugin zip created: ${filename}`);
                } catch (zipErr) {
                    logError('Plugin zip generation failed', zipErr);
                }

                // Store both key and plugin URL in Stripe customer metadata
                await stripe.customers.update(stripeId, {
                    metadata: {
                        litellm_key: generatedKey,
                        ...(pluginZipUrl ? { plugin_zip_url: pluginZipUrl } : {})
                    }
                });
                logInfo(`Key generated — alias=${keyAlias} budget=₹${meta.key_budget} team=${meta.team_id}`);
            } else {
                // Topping up an existing key
                logInfo(`Topping up existing key`, { stripeId, existingKey });
                const keyInfoResp = await litellm.get(`/key/info?key=${existingKey}`);
                const currentAvailableBudget = keyInfoResp.data.info.metadata?.available_budget || 0;
                const currentKeyMaxBudget = keyInfoResp.data.info.max_budget || 0;
                const newKeyMaxBudget = currentKeyMaxBudget + meta.key_metadata_available_budget;
                const newAvailableBudget = currentAvailableBudget + meta.key_metadata_available_budget;

                await litellm.post('/key/update', {
                    key: existingKey,
                    add_to_max_budget: newKeyMaxBudget,
                    metadata: {
                        ...(keyInfoResp.data.info.metadata || {}),
                        available_budget: newAvailableBudget
                    }
                });
                logInfo(`Key topped up — added budget=₹${meta.key_budget}, new available=₹${newAvailableBudget} for ${stripeId}`);
            }
        } catch (e) {
            logError("Fulfillment Error", e);
        }
    }
    res.json({ received: true });
});

/**
 * 2. Success Page
 * Renders the success UI with order details for support reference.
 * http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}
 */
app.get('/success', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.redirect('/');

    let orderDetails = { session_id, email: null, customer_id: null, amount: null, currency: null };
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        orderDetails.email = session.customer_details?.email || null;
        orderDetails.customer_id = session.customer || null;
        orderDetails.amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : null;
        orderDetails.currency = session.currency?.toUpperCase() || 'USD';
    } catch (e) {
        console.error('[success] Could not fetch session details:', e.message);
    }

    res.render('success', { session_id, orderDetails });
});

/**
 * 3. Polling API
 * Checks if the webhook finished updating Stripe metadata.
 */
app.get('/api/check-key', apiLimiter, async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ status: 'error', message: 'Missing session_id' });

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        let customerId = session.customer;
        if (!customerId && session.customer_details?.email) {
            const customers = await stripe.customers.list({ email: session.customer_details.email, limit: 1 });
            if (customers.data.length > 0) customerId = customers.data[0].id;
        }

        if (!customerId) {
            console.warn('[check-key] no customer found/created yet for session:', session_id);
            return res.json({ status: 'processing' });
        }

        const customer = await stripe.customers.retrieve(customerId);
        const key = customer.metadata?.litellm_key;
        const pluginUrl = customer.metadata?.plugin_zip_url || null;

        console.log(`[check-key] session=${session_id} customer=${session.customer} key=${key ? '✓' : 'pending'} plugin=${pluginUrl ? '✓' : 'n/a'}`);
        res.json({ status: key ? 'ready' : 'processing', key, pluginUrl });
    } catch (e) {
        console.error('[check-key] ERROR:', e.message, '| session_id:', session_id);
        res.status(500).json({ status: 'error', message: e.message });
    }
});

/**
 * 4a. Billing Portal — by LiteLLM key (used from success page)
 */
app.get('/billing/portal', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).send("Key is required");

    try {
        // Fetch key info from LiteLLM instead of searching Stripe
        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(key)}`);

        // Depending on LiteLLM version, metadata might be in data.info.metadata or data.metadata
        const metadata = keyInfoResp.data?.metadata || keyInfoResp.data?.info?.metadata || {};
        const stripeId = metadata.stripe_id;

        if (!stripeId) {
            console.warn(`[portal] No stripe_id found in LiteLLM metadata for key: ${key}`);
            return res.status(404).send("User not found: No associated Stripe customer linked to this key.");
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeId,
            return_url: `${process.env.BASE_URL}/`,
        });
        res.redirect(portalSession.url);
    } catch (e) {
        console.error('[portal] Error:', e.response?.data || e.message);
        res.status(500).send("Portal Error: " + (e.response?.data?.error?.message || e.message));
    }
});

/**
 * 4b. Billing Portal — by email (used from login button)
 * User just enters their email; we find them in Stripe and redirect.
 */
app.post('/billing/portal-by-email', express.json(), async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const customers = await stripe.customers.list({ email: email.trim().toLowerCase(), limit: 1 });
        if (customers.data.length === 0) {
            return res.status(404).json({ error: 'No account found with that email address.' });
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customers.data[0].id,
            return_url: `${process.env.BASE_URL}/`,
        });
        res.json({ url: portalSession.url });
    } catch (e) {
        console.error('[portal-by-email] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/**
 * API: Fetch info by litellm key
 */
app.get('/api/key-info', express.json(), async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key is required' });
    let q = key.trim();

    try {

        const keyInfoResp = await litellm.get(`/key/info?key=${encodeURIComponent(q)}`);
        const metadata = keyInfoResp.data?.metadata || keyInfoResp.data?.info?.metadata || {};
        const availableBudget = metadata.available_budget || 0;
        res.json({
            available_budget: availableBudget
        });

    } catch (e) {

        console.error('[topup-info] Error:', e.message);
        return res.status(404).json({ error: 'Invalid LiteLLM key or not found.' });
    }
});

app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running!`);
    console.log(`📡 Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
    if (isDev) console.log(`🛠️  Debug Route: http://localhost:${PORT}/debug/customer/YOUR_EMAIL\n`);
});
