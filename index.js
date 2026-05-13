'use strict';

require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.send('Messenger webhook server is running.');
});

// Webhook verification — Facebook sends GET with hub.* params
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.warn('Webhook verification failed — token mismatch');
    res.sendStatus(403);
  }
});

// Receive events — must respond 200 OK quickly
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  res.sendStatus(200); // Acknowledge immediately before processing

  body.entry.forEach(entry => {
    const events = entry.messaging;
    if (!events) return;

    events.forEach(event => {
      const senderId = event.sender.id;

      if (event.message) {
        handleMessage(senderId, event.message);
      } else if (event.postback) {
        handlePostback(senderId, event.postback);
      } else if (event.delivery) {
        console.log(`Message delivered to ${senderId}`);
      } else if (event.read) {
        console.log(`Message read by ${senderId}`);
      }
    });
  });
});

function handleMessage(senderId, message) {
  console.log(`Message from ${senderId}:`, message);

  if (message.text) {
    console.log(`Text: "${message.text}"`);
    // TODO: reply via Send API using PAGE_ACCESS_TOKEN
  } else if (message.attachments) {
    message.attachments.forEach(att => {
      console.log(`Attachment type: ${att.type}, url: ${att.payload?.url}`);
    });
  }
}

function handlePostback(senderId, postback) {
  console.log(`Postback from ${senderId}: payload="${postback.payload}" title="${postback.title}"`);
  // TODO: handle button/quick-reply postbacks
}

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Verification endpoint: GET /webhook`);
  console.log(`Events endpoint:       POST /webhook`);
});
