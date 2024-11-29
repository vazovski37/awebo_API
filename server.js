const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

// Middleware to parse JSON
app.use(express.json());

// Replace with your Slack Bot User OAuth Token
const slackToken = 'xoxb-8048268267043-8041803213414-pRJw9cujVpwHeUt8Le6PpDQH';
let botUserId = '';

// Fetch the bot's user ID on server start
async function fetchBotUserId() {
  try {
    const response = await axios.get('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${slackToken}` },
    });

    if (response.data.ok) {
      botUserId = response.data.user_id;
      console.log('Bot user ID:', botUserId);
    } else {
      console.error('Failed to fetch bot user ID:', response.data.error);
    }
  } catch (error) {
    console.error('Error fetching bot user ID:', error.message);
  }
}

fetchBotUserId();

// Helper function to save messages to a file
function saveMessageToFile(workspaceID, channelID, message) {
  const workspacePath = path.join(__dirname, workspaceID);
  const channelPath = path.join(workspacePath, channelID);
  const filePath = path.join(channelPath, 'messages.txt');

  // Ensure directories exist
  fs.mkdirSync(channelPath, { recursive: true });

  // Prepend message to the file
  const logEntry = `[${new Date().toISOString()}] ${message}\n`;
  let existingContent = '';

  if (fs.existsSync(filePath)) {
    existingContent = fs.readFileSync(filePath, 'utf8');
  }

  const updatedContent = logEntry + existingContent;
  fs.writeFileSync(filePath, updatedContent, 'utf8');
}

// Function to send a message to Slack
async function sendMessageToSlack(channel, text) {
  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text },
      {
        headers: {
          Authorization: `Bearer ${slackToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!response.data.ok) {
      console.error('Failed to send message:', response.data.error);
    }
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
}

// Handle Slack events
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  // URL verification
  if (type === 'url_verification') {
    return res.status(200).send({ challenge });
  }

  // Event callbacks
  if (type === 'event_callback' && event) {
    const { type: eventType, text, user, channel, bot_id, team_id } = event;

    // Ignore bot messages and messages from the bot itself
    if (bot_id || user === botUserId) return res.sendStatus(200);

    try {
      // Save messages from channels and DMs
      if (eventType === 'message' && text) {
        const receivedMessage = `User: ${user}, Message: "${text}"`;

        // Save received message to the appropriate file
        saveMessageToFile(team_id, channel, receivedMessage);
        console.log('Message saved:', receivedMessage);

        // Bot's static response
        const botResponse = `Hello! You said: "${text}"`;

        // Send response to Slack
        await sendMessageToSlack(channel, botResponse);

        // Log bot's response to the appropriate file
        const responseLog = `Bot Response: ${botResponse}`;
        saveMessageToFile(team_id, channel, responseLog);
        console.log('Response saved:', responseLog);
      }
    } catch (error) {
      console.error('Error processing event:', error.message);
    }
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// API to get messages.txt for a specific workspace and channel
app.get('/api/messages', (req, res) => {
  const { workspaceID, channelID } = req.query;

  if (!workspaceID || !channelID) {
    return res.status(400).send({ error: 'workspaceID and channelID are required' });
  }

  const filePath = path.join(__dirname, workspaceID, channelID, 'messages.txt');

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send({ error: 'Messages file not found for the specified workspace and channel' });
  }
});

// Start the server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
