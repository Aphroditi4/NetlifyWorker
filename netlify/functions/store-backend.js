const { handleStoreBackend } = require('./utils/proxy');

exports.handler = async (event, context) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    return await handleStoreBackend(event, url);
  } catch (error) {
    console.error('Error in store-backend handler:', error);
    
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