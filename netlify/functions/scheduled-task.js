const { retryCachedTelegramMessages } = require('./utils/telegram');

// Netlify scheduled function
exports.handler = async (event, context) => {
  try {
    console.log('Running scheduled task at:', new Date().toISOString());
    await retryCachedTelegramMessages();
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Scheduled task completed successfully' })
    };
  } catch (error) {
    console.error('Error in scheduled task:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};