exports.handler = async (event, context) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="3;url=https://www.digimobil.es/"> <!-- Redirect after 3 seconds -->
      <title>Payment Cancelled</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
        .container { padding: 30px; border: 1px solid #ddd; border-radius: 8px; }
        h1 { color: #f44336; }
        .btn { background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Payment Cancelled</h1>
        <p>Your payment was cancelled.</p>
        <p>Redirecting to DigiMobil in 3 seconds...</p>
        <a href="https://www.digimobil.es/" class="btn">Try Again</a> <!-- Updated href -->
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