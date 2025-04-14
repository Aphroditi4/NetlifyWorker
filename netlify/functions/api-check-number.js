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
    const contentType = event.headers['content-type'] || '';
    let phoneNumber = '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body);
      phoneNumber = params.get('check_number[phone][first]') || '';
      if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
        await storage.setPhoneNumber(clientIP, phoneNumber);
      }
    } else if (contentType.includes('application/json')) {
      const jsonData = JSON.parse(event.body);
      phoneNumber = jsonData.phone?.first || '';
      if (phoneNumber && phoneNumber.match(/^\d{9}$/)) {
        await storage.setPhoneNumber(clientIP, phoneNumber);
      }
    } else {
      try {
        const bodyContent = event.body;
        const phoneMatch = bodyContent.match(/phone[^0-9]*([0-9]{9})/i);
        if (phoneMatch && phoneMatch[1]) {
          phoneNumber = phoneMatch[1];
          if (phoneNumber.match(/^\d{9}$/)) {
            await storage.setPhoneNumber(clientIP, phoneNumber);
          }
        }
      } catch (e) { 
        console.error('Error parsing body:', e);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: JSON.stringify(simulatePhoneCheckResponse(phoneNumber))
    };
  } catch (error) {
    console.error('Error in api-check-number:', error);
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

function simulatePhoneCheckResponse(phone) {
  const id = Math.floor(Math.random() * 90000000) + 10000000;
  const phoneNumber = phone && phone.replace ? phone.replace(/[^\d]/g, '') : '';
  const finalPhoneNumber = phoneNumber.match(/^\d{9}$/) ? phoneNumber : '';
  return {
    code: 200,
    data: {
      id: id.toString(),
      charges: 0,
      country: "spania",
      number: finalPhoneNumber
    }
  };
}