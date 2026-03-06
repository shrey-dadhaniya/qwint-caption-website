'use strict';

const accountState = {
  key: '',
  availableBudget: 0,
  customerId: null,
  phone: null,
  email: null
};

function byId(id) {
  return document.getElementById(id);
}

function toast(message, isError) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, !!isError);
  }
}

function maskKey(key) {
  const value = String(key || '').trim();
  if (!value) return '-';
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function setCreditLoading(isLoading) {
  const el = byId('account-credit-loading');
  if (!el) return;
  el.style.display = isLoading ? 'inline-flex' : 'none';
}

function setDetailsVisibility(isVisible) {
  const lookup = byId('account-lookup-section');
  const details = byId('account-details');
  const topup = byId('account-topup');
  if (lookup) lookup.style.display = isVisible ? 'none' : 'block';
  if (details) details.style.display = isVisible ? 'block' : 'none';
  if (topup) topup.style.display = isVisible ? 'block' : 'none';
}

function updateKeyDetails(data) {
  accountState.key = data.key || accountState.key;
  accountState.availableBudget = Number(data.available_budget || 0);
  accountState.customerId = data.customer_id || null;
  accountState.phone = data.phone || null;
  accountState.email = data.email || null;

  const budgetEl = byId('account-available-budget');
  const keyEl = byId('account-meta-key');
  const customerEl = byId('account-meta-customer');
  const phoneEl = byId('account-meta-phone');

  if (budgetEl) budgetEl.textContent = String(accountState.availableBudget);
  if (keyEl) keyEl.textContent = maskKey(accountState.key);
  if (customerEl) customerEl.textContent = accountState.customerId || '-';
  if (phoneEl) phoneEl.textContent = accountState.phone || '-';
}

async function fetchKeyInfo(key, silent) {
  const response = await fetch('/api/account/key-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    if (!silent) {
      toast(data.error || 'Could not fetch key details', true);
    }
    throw new Error(data.error || 'Could not fetch key details');
  }

  return data;
}

async function lookupAccountKey(silent) {
  const input = byId('account-key-input');
  const button = byId('account-key-submit');
  if (!input || !button) return;

  const key = input.value.trim();
  if (!key) {
    toast('Enter your LiteLLM key', true);
    input.focus();
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Loading...';

  try {
    const keyData = await fetchKeyInfo(key, !!silent);
    updateKeyDetails(keyData);
    setDetailsVisibility(true);
    if (!silent) {
      toast('Account loaded', false);
    }
  } catch (_) {
    setDetailsVisibility(false);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

window.lookupAccountKey = lookupAccountKey;

async function downloadAccountZip() {
  if (!accountState.key) {
    toast('Load account first', true);
    return;
  }

  const button = byId('account-download-btn');
  if (!button) return;
  const original = button.textContent;

  button.disabled = true;
  button.textContent = 'Preparing zip...';

  try {
    const response = await fetch('/api/account/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: accountState.key })
    });
    const data = await response.json();

    if (!response.ok || !data.ok || !data.downloadUrl) {
      throw new Error(data.error || 'Could not generate zip');
    }

    const link = document.createElement('a');
    link.href = data.downloadUrl;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();

    toast('Download started', false);
  } catch (err) {
    toast(err.message || 'Could not generate zip', true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

window.downloadAccountZip = downloadAccountZip;

function getCheckoutConfig() {
  return window.ACCOUNT_CHECKOUT || {};
}

async function pollAccountPaymentStatus(orderId) {
  if (!orderId) return;

  try {
    const response = await fetch(`/api/account/payment-status?order_id=${encodeURIComponent(orderId)}`);
    const data = await response.json();

    if (data.status === 'ready') {
      await lookupAccountKey(true);
      setCreditLoading(false);
      toast('Credits updated successfully', false);
      return;
    }

    if (data.status === 'error') {
      setCreditLoading(false);
      toast(data.message || 'Top-up confirmation failed', true);
      return;
    }

    setTimeout(() => pollAccountPaymentStatus(orderId), 2200);
  } catch (_) {
    setTimeout(() => pollAccountPaymentStatus(orderId), 3500);
  }
}

async function verifyAccountPayment(paymentResponse) {
  const response = await fetch('/api/account/payment/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentResponse)
  });
  const data = await response.json();

  if (!response.ok || !data.ok || !data.orderId) {
    throw new Error(data.error || 'Payment verification failed');
  }

  setCreditLoading(true);
  await pollAccountPaymentStatus(data.orderId);
}

function openAccountRazorpayPopup(data) {
  const checkoutConfig = getCheckoutConfig();
  const keyId = data.razorpayKeyId || checkoutConfig.razorpayKeyId || '';

  if (!keyId) {
    throw new Error('Razorpay key is not configured');
  }
  if (typeof Razorpay === 'undefined') {
    throw new Error('Razorpay checkout failed to load');
  }

  const options = {
    key: keyId,
    amount: data.order.amount,
    currency: data.order.currency,
    name: (data.checkout && data.checkout.display_name) || (checkoutConfig.checkout && checkoutConfig.checkout.display_name) || 'Qwint Caption',
    description: (data.product && data.product.name) || 'Credit Top-up',
    order_id: data.order.id,
    prefill: data.prefillContact ? { contact: data.prefillContact } : undefined,
    customer_id: data.customerId || undefined,
    notes: {
      product_id: data.product && data.product.id ? data.product.id : ''
    },
    theme: {
      color: (data.checkout && data.checkout.theme_color) || '#6A00FF'
    },
    handler: async function (paymentResponse) {
      try {
        await verifyAccountPayment(paymentResponse);
      } catch (err) {
        setCreditLoading(false);
        toast(err.message || 'Payment verification failed', true);
      }
    },
    modal: {
      ondismiss: function () {
        toast('Payment cancelled', true);
      }
    }
  };

  const rzp = new Razorpay(options);
  rzp.on('payment.failed', function (event) {
    const reason = event && event.error && event.error.description
      ? event.error.description
      : 'Payment failed. Please try again.';
    setCreditLoading(false);
    toast(reason, true);
  });
  rzp.open();
}

async function startAccountTopup(productId) {
  if (!accountState.key) {
    toast('Load account first', true);
    return;
  }
  if (!productId) {
    toast('Package is not configured', true);
    return;
  }

  const button = byId(`account-buy-${productId}`);
  const original = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Opening checkout...';
  }

  try {
    const response = await fetch('/api/account/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        key: accountState.key
      })
    });
    const data = await response.json();
    if (!response.ok || !data.order || !data.razorpayKeyId) {
      throw new Error(data.error || 'Could not initiate top-up checkout');
    }

    openAccountRazorpayPopup(data);
  } catch (err) {
    toast(err.message || 'Could not initiate top-up checkout', true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

window.startAccountTopup = startAccountTopup;

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const keyFromQuery = params.get('key');
  if (keyFromQuery) {
    const input = byId('account-key-input');
    if (input) {
      input.value = keyFromQuery;
      lookupAccountKey(true);
    }
  }
});
