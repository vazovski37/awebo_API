const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Replace with your Slack Bot User OAuth Token
const SLACK_BOT_TOKEN = 'xoxb-8048268267043-8041803213414-pRJw9cujVpwHeUt8Le6PpDQH'; // Replace with your actual bot token

// Middleware
app.use(bodyParser.json());

// Save message to file function
function saveMessageToFile(workspaceID, channelID, message) {
  if (!workspaceID || !channelID) {
    console.error('Error: workspaceID or channelID is undefined.');
    console.error(`workspaceID: ${workspaceID}, channelID: ${channelID}`);
    return;
  }

  const workspacePath = path.join(__dirname, workspaceID);
  const channelPath = path.join(workspacePath, channelID);
  const filePath = path.join(channelPath, 'messages.txt');

  try {
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
  } catch (error) {
    console.error('Error saving message to file:', error.message);
  }
}

// Endpoint for Slack events
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;

  // URL verification
  if (type === 'url_verification') {
    return res.status(200).send({ challenge });
  }

  if (type === 'event_callback' && event) {
    const { type: eventType, text, user, channel, bot_id, team } = event;

    // Log received data for debugging
    console.log('Received Event:', { team, channel, user, text });

    // Ignore bot messages and messages from the bot itself
    if (bot_id || !user) return res.sendStatus(200);

    // Validate team and channel
    if (!team || !channel) {
      console.error('Error: Missing team or channel in the event.');
      console.error(`Event Payload: ${JSON.stringify(event, null, 2)}`);
      return res.sendStatus(400); // Bad Request
    }

    try {
      if (eventType === 'message' && text) {
        const receivedMessage = `User: ${user}, Message: "${text}"`;

        // Save received message
        saveMessageToFile(team, channel, receivedMessage);
        console.log('Message saved:', receivedMessage);

        const botResponse = `Hello! You said: "${text}"`;
        const slackResponse = await sendMessageToSlack(channel, botResponse);

        if (slackResponse.ok) {
          const responseLog = `Bot Response: ${botResponse}`;
          saveMessageToFile(team, channel, responseLog);
          console.log('Response saved:', responseLog);
        } else {
          console.error('Failed to send message to Slack:', slackResponse.error);
        }
      }
    } catch (error) {
      console.error('Error processing event:', error.message);
    }

    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// Fetch messages for a workspace and channel
app.get('/api/messages', (req, res) => {
  const { workspaceID, channelID } = req.query;

  console.log('Fetching messages for:', { workspaceID, channelID });

  if (!workspaceID || !channelID) {
    console.error('Error: Missing workspaceID or channelID in request.');
    return res.status(400).send({ error: 'workspaceID and channelID are required' });
  }

  const filePath = path.join(__dirname, workspaceID, channelID, 'messages.txt');

  if (fs.existsSync(filePath)) {
    console.log(`Sending file: ${filePath}`);
    return res.sendFile(filePath);
  } else {
    console.error('Messages file not found:', filePath);
    return res.status(404).send({ error: 'Messages file not found for the specified workspace and channel' });
  }
});

// Send a message to Slack
async function sendMessageToSlack(channel, text) {
  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channel,
        text: text,
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error sending message to Slack:', error.message);
    return { ok: false, error: error.message };
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
