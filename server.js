require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Add your Gemini API key

let botUserId = '';

// Middleware
app.use(bodyParser.json());

// Fetch bot's user ID on server start
async function fetchBotUserId() {
  try {
    const response = await axios.get('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
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

// Get response from Gemini AI
async function getGeminiAIResponse(userMessage) {
  try {
    const requestBody = {
      contents: [
        {
          parts: [
            { text: userMessage },
          ],
        },
      ],
    };

    console.log('Sending request to Gemini API:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    // Validate and parse the response
    if (
      response.data &&
      response.data.candidates &&
      response.data.candidates.length > 0 &&
      response.data.candidates[0].content &&
      response.data.candidates[0].content.parts &&
      response.data.candidates[0].content.parts.length > 0 &&
      response.data.candidates[0].content.parts[0].text
    ) {
      return response.data.candidates[0].content.parts[0].text.trim();
    } else {
      console.error('Invalid response from Gemini API:', response.data);
      return 'I’m sorry, I couldn’t generate a response at the moment.';
    }
  } catch (error) {
    console.error('Error getting response from Gemini API:', error.response?.data || error.message);
    return 'There was an error processing your request. Please try again later.';
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
    const { type: eventType, text, user, channel, bot_id, team, channel_type } = event;

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

        // Bot logic
        let shouldRespond = false;

        if (channel_type === 'channel' && text.includes(`<@${botUserId}>`)) {
          // Respond only if mentioned in a channel
          shouldRespond = true;
        } else if (channel_type === 'im') {
          // Respond to every message in DMs
          shouldRespond = true;
        }

        if (shouldRespond) {
          // Fetch response from Gemini AI
          const geminiResponse = await getGeminiAIResponse(text);
          const slackResponse = await sendMessageToSlack(channel, geminiResponse);

          if (slackResponse.ok) {
            const responseLog = `Bot Response: ${geminiResponse}`;
            saveMessageToFile(team, channel, responseLog);
            console.log('Response saved:', responseLog);
          } else {
            console.error('Failed to send message to Slack:', slackResponse.error);
          }
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
