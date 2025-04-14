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
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';
    const data = JSON.parse(event.body);
    const phoneNumber = data.phoneNumber;
    
    if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
      await storage.setPhoneNumber(clientIP, phoneNumber);
      console.log('Stored phone number:', phoneNumber, 'for IP:', clientIP);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*'
        },
        body: 'Phone number stored'
      };
    }
    
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      },
      body: 'Invalid phone number'
    };
  } catch (error) {
    console.error('Error storing phone:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      },
      body: 'Error storing phone number'
    };
  }
};