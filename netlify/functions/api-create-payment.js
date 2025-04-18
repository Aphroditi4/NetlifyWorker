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
    const contentType = event.headers['content-type'] || '';
    let amount, phoneNumber, successUrl, cancelUrl;
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';

    // Extract request data
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(event.body);
        amount = data.amount;
        phoneNumber = data.phoneNumber;
        successUrl = data.successUrl || `https://www.digimobil.es/`;
        cancelUrl = data.cancelUrl || `https://${MIRROR_DOMAIN}/payment-cancel`;
        
        // Log raw data
        console.log('API RECEIVED RAW JSON:', event.body);
        console.log('API PHONE NUMBER TYPE:', typeof phoneNumber);
        console.log('API PHONE NUMBER VALUE:', phoneNumber);
      } catch (e) {
        console.error('Error parsing JSON:', e);
        console.log('RAW BODY:', event.body);
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body);
      amount = params.get('amount');
      phoneNumber = params.get('phoneNumber');
      successUrl = params.get('successUrl') || `https://${MIRROR_DOMAIN}/payment-success`;
      cancelUrl = params.get('cancelUrl') || `https://${MIRROR_DOMAIN}/payment-cancel`;
    } else {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unsupported content type' })
      };
    }

    // Simplified validation for phone - skip fetching from storage
    // Just log it for debugging purposes
    console.log('Processing payment request:', { amount, phoneNumber, clientIP });

    if (!amount || isNaN(amount)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid amount. Required: amount (number)' })
      };
    }

    const { session } = await createStripeCheckoutSession(
      parseFloat(amount),
      phoneNumber, // Pass the original phone number without validation
      `https://www.digimobil.es/`, // Updated success URL
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