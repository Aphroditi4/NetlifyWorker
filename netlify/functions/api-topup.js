const { MIRROR_DOMAIN } = require('./utils/constants');
const { createStripeCheckoutSession } = require('./utils/stripe');
const storage = require('./db/storage');

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
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const contentType = event.headers['content-type'] || '';
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';
    
    let amount, phoneNumber;

    if (url.searchParams.has('phone') || url.searchParams.has('amount')) {
      phoneNumber = url.searchParams.get('phone') || url.searchParams.get('phone_number') || url.searchParams.get('msisdn') || url.searchParams.get('number');
      amount = url.searchParams.get('amount') || url.searchParams.get('topup_amount') || url.searchParams.get('value');
    }

    if (!phoneNumber || !amount) {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(event.body);
        phoneNumber = phoneNumber || params.get('phone') || params.get('phone_number') || params.get('msisdn') || params.get('number');
        amount = amount || params.get('amount') || params.get('topup_amount') || params.get('value');
      } else if (contentType.includes('application/json')) {
        const jsonData = JSON.parse(event.body);
        phoneNumber = phoneNumber || jsonData.phone || jsonData.phone_number || jsonData.msisdn || jsonData.number;
        amount = amount || jsonData.amount || jsonData.topup_amount || jsonData.value;
      }
    }

    if (!phoneNumber || !phoneNumber.match(/^\d{9}$/)) {
      // Вимагаємо дійсний номер телефону
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

    amount = amount || '5';
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) amount = '5';

    console.log('Processing topup request:', { amount, phoneNumber, clientIP });

    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber,
      `https://${MIRROR_DOMAIN}/payment-success`,
      `https://${MIRROR_DOMAIN}/payment-cancel`,
      clientIP
    );

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
        'Location': `https://${MIRROR_DOMAIN}/recargar`,
        'Cache-Control': 'no-cache'
      },
      body: ''
    };
  }
};