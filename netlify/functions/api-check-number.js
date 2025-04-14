// Простий обробник, який автоматично повертає успішну відповідь для перевірки номера
exports.handler = async (event, context) => {
  // Підтримка CORS
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
    // Генеруємо випадковий ID для відповіді
    const id = Math.floor(Math.random() * 90000000) + 10000000;
    
    // Намагаємося отримати номер телефону з запиту, якщо він є
    let phoneNumber = '';
    try {
      if (event.body) {
        const contentType = event.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          const jsonData = JSON.parse(event.body);
          phoneNumber = jsonData.phone?.first || '';
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(event.body);
          phoneNumber = params.get('check_number[phone][first]') || '';
        } else {
          const bodyContent = event.body;
          const phoneMatch = bodyContent.match(/phone[^0-9]*([0-9]{9})/i);
          if (phoneMatch && phoneMatch[1]) {
            phoneNumber = phoneMatch[1];
          }
        }
      }
    } catch (e) {
      console.error('Error parsing request body:', e);
    }

    // Завжди повертаємо успішну відповідь
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: JSON.stringify({
        code: 200,
        data: {
          id: id.toString(),
          charges: 0,
          country: "spania",
          number: phoneNumber.match(/^\d{9}$/) ? phoneNumber : ''
        }
      })
    };
  } catch (error) {
    console.error('Error in api-check-number:', error);
    
    // Навіть у випадку помилки повертаємо успішну відповідь
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      body: JSON.stringify({
        code: 200,
        data: {
          id: Math.floor(Math.random() * 90000000) + 10000000,
          charges: 0,
          country: "spania",
          number: ""
        }
      })
    };
  }
};