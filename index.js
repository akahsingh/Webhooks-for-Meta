'use strict';

require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;

// In-memory log store (last 100 events)
const eventLog = [];
function addLog(type, data) {
  eventLog.unshift({ time: new Date().toISOString(), type, data });
  if (eventLog.length > 100) eventLog.pop();
}

// Health check
app.get('/', (req, res) => {
  res.send('Messenger webhook server is running. Visit <a href="/logs">/logs</a> to see events.');
});

// Allow Facebook crawler
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\n\nUser-agent: facebookexternalhit\nAllow: /');
});

// Live logs viewer
app.get('/logs', (req, res) => {
  const rows = eventLog.length
    ? eventLog.map(e => `
        <tr>
          <td style="white-space:nowrap;padding:6px 12px;color:#888">${e.time}</td>
          <td style="padding:6px 12px;font-weight:bold;color:#4a9eff">${e.type}</td>
          <td style="padding:6px 12px"><pre style="margin:0;white-space:pre-wrap">${JSON.stringify(e.data, null, 2)}</pre></td>
        </tr>`).join('')
    : '<tr><td colspan="3" style="padding:20px;text-align:center;color:#888">No events received yet. Send a message to your Facebook Page.</td></tr>';

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Webhook Logs</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: monospace; background: #1a1a1a; color: #eee; margin: 0; padding: 20px; }
    h1 { color: #4a9eff; margin-bottom: 4px; }
    p { color: #888; margin: 0 0 20px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #333; }
    tr:hover { background: #252525; }
    th { text-align: left; padding: 8px 12px; background: #252525; color: #aaa; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Webhook Events</h1>
  <p>Auto-refreshes every 5 seconds &mdash; ${eventLog.length} event(s) stored &mdash; <a href="/logs" style="color:#4a9eff">Refresh now</a></p>
  <table>
    <thead><tr><th>Time</th><th>Type</th><th>Data</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
});

// Webhook verification — Facebook sends GET with hub.* params
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[verify] mode=${mode} receivedToken=${token} expectedToken=${VERIFY_TOKEN}`);
  addLog('verification', { mode, token, challenge, success: mode === 'subscribe' && token === VERIFY_TOKEN });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[verify] SUCCESS');
    res.status(200).send(challenge);
  } else {
    console.warn('[verify] FAILED — mode or token mismatch');
    res.sendStatus(403);
  }
});

// Receive events — must respond 200 OK quickly
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  res.sendStatus(200);

  body.entry.forEach(entry => {
    const events = entry.messaging;
    if (!events) return;

    events.forEach(event => {
      const senderId = event.sender.id;

      if (event.message && event.message.is_echo) {
        addLog('message_echo', { senderId, message: event.message });
      } else if (event.message) {
        addLog('message', { senderId, message: event.message });
        handleMessage(senderId, event.message);
      } else if (event.postback) {
        addLog('postback', { senderId, postback: event.postback });
        handlePostback(senderId, event.postback);
      } else if (event.delivery) {
        addLog('delivery', { senderId });
        console.log(`Message delivered to ${senderId}`);
      } else if (event.read) {
        addLog('read', { senderId });
        console.log(`Message read by ${senderId}`);
      } else {
        addLog('unknown', { senderId, event });
      }
    });
  });
});

function handleMessage(senderId, message) {
  console.log(`Message from ${senderId}:`, message);
  if (message.text) {
    console.log(`Text: "${message.text}"`);
  } else if (message.attachments) {
    message.attachments.forEach(att => {
      console.log(`Attachment type: ${att.type}, url: ${att.payload?.url}`);
    });
  }
}

function handlePostback(senderId, postback) {
  console.log(`Postback from ${senderId}: payload="${postback.payload}" title="${postback.title}"`);
}

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Logs viewer: /logs`);
});
