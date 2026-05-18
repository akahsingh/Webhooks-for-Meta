'use strict';

require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// In-memory log store (last 100 events)
const eventLog = [];
function addLog(platform, type, data) {
  eventLog.unshift({ time: new Date().toISOString(), platform, type, data });
  if (eventLog.length > 100) eventLog.pop();
}

// Health check
app.get('/', (req, res) => {
  res.send('Meta webhook server is running. Visit <a href="/logs">/logs</a> to see events.');
});

// Allow Facebook crawler
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\n\nUser-agent: facebookexternalhit\nAllow: /');
});

// Live logs viewer
app.get('/logs', (req, res) => {
  const platformColor = {
    messenger:  '#4a9eff',
    whatsapp:   '#25d366',
    instagram:  '#e1306c',
    marketing:  '#f5a623',
    system:     '#aaaaaa',
  };

  const rows = eventLog.length
    ? eventLog.map(e => {
        const color = platformColor[e.platform] || '#fff';
        return `
        <tr>
          <td style="white-space:nowrap;padding:6px 12px;color:#888">${e.time}</td>
          <td style="padding:6px 12px;font-weight:bold;color:${color}">${e.platform}</td>
          <td style="padding:6px 12px;color:#ccc">${e.type}</td>
          <td style="padding:6px 12px"><pre style="margin:0;white-space:pre-wrap">${JSON.stringify(e.data, null, 2)}</pre></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" style="padding:20px;text-align:center;color:#888">No events received yet.</td></tr>';

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Meta Webhook Logs</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: monospace; background: #1a1a1a; color: #eee; margin: 0; padding: 20px; }
    h1 { color: #fff; margin-bottom: 4px; }
    .legend { margin-bottom: 16px; font-size: 13px; }
    .legend span { margin-right: 16px; }
    p { color: #888; margin: 0 0 20px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #333; }
    tr:hover { background: #252525; }
    th { text-align: left; padding: 8px 12px; background: #252525; color: #aaa; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Meta Webhook Events</h1>
  <div class="legend">
    <span style="color:#4a9eff">&#9632; Messenger</span>
    <span style="color:#25d366">&#9632; WhatsApp</span>
    <span style="color:#e1306c">&#9632; Instagram</span>
    <span style="color:#f5a623">&#9632; Marketing</span>
  </div>
  <p>Auto-refreshes every 5 seconds &mdash; ${eventLog.length} event(s) stored &mdash; <a href="/logs" style="color:#4a9eff">Refresh now</a></p>
  <table>
    <thead><tr><th>Time</th><th>Platform</th><th>Type</th><th>Data</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
});

// Webhook verification — same endpoint works for all Meta platforms
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[verify] mode=${mode} receivedToken=${token} expectedToken=${VERIFY_TOKEN}`);
  addLog('system', 'verification', { mode, token, success: mode === 'subscribe' && token === VERIFY_TOKEN });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[verify] SUCCESS');
    res.status(200).send(challenge);
  } else {
    console.warn('[verify] FAILED — mode or token mismatch');
    res.sendStatus(403);
  }
});

// Receive events from all Meta platforms
app.post('/webhook', (req, res) => {
  const body = req.body;
  res.sendStatus(200); // Always acknowledge immediately

  const object = body.object;
  console.log(`[webhook] object=${object}`);

  if (object === 'page') {
    handleMessenger(body);
  } else if (object === 'whatsapp_business_account') {
    handleWhatsApp(body);
  } else if (object === 'instagram') {
    handleInstagram(body);
  } else if (object === 'ad_account') {
    handleMarketing(body);
  } else {
    addLog('system', 'unknown_object', { object, body });
  }
});

// ── Messenger ────────────────────────────────────────────────────────────────
function handleMessenger(body) {
  body.entry.forEach(entry => {
    (entry.messaging || []).forEach(event => {
      const senderId = event.sender.id;
      if (event.message && event.message.is_echo) {
        addLog('messenger', 'message_echo', { senderId, message: event.message });
      } else if (event.message) {
        addLog('messenger', 'message', { senderId, message: event.message });
        console.log(`[messenger] message from ${senderId}: ${event.message.text}`);
      } else if (event.postback) {
        addLog('messenger', 'postback', { senderId, postback: event.postback });
        console.log(`[messenger] postback from ${senderId}: ${event.postback.payload}`);
      } else if (event.delivery) {
        addLog('messenger', 'delivery', { senderId });
      } else if (event.read) {
        addLog('messenger', 'read', { senderId });
      } else {
        addLog('messenger', 'unknown', { senderId, event });
      }
    });
  });
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────
function handleWhatsApp(body) {
  body.entry.forEach(entry => {
    (entry.changes || []).forEach(change => {
      const field = change.field;
      const value = change.value;

      if (field === 'messages') {
        (value.messages || []).forEach(msg => {
          addLog('whatsapp', msg.type, {
            from: msg.from,
            id: msg.id,
            timestamp: msg.timestamp,
            text: msg.text?.body,
            type: msg.type,
          });
          console.log(`[whatsapp] ${msg.type} from ${msg.from}: ${msg.text?.body || ''}`);
        });

        (value.statuses || []).forEach(status => {
          addLog('whatsapp', `status_${status.status}`, {
            recipientId: status.recipient_id,
            status: status.status,
            timestamp: status.timestamp,
          });
        });
      } else {
        addLog('whatsapp', field, value);
      }
    });
  });
}

// ── Instagram ─────────────────────────────────────────────────────────────────
function handleInstagram(body) {
  body.entry.forEach(entry => {
    // Instagram Messaging (DMs)
    (entry.messaging || []).forEach(event => {
      const senderId = event.sender.id;
      if (event.message) {
        addLog('instagram', 'dm', { senderId, message: event.message });
        console.log(`[instagram] DM from ${senderId}: ${event.message.text}`);
      } else if (event.postback) {
        addLog('instagram', 'postback', { senderId, postback: event.postback });
      } else {
        addLog('instagram', 'messaging_event', { senderId, event });
      }
    });

    // Instagram feed changes (comments, mentions, story replies)
    (entry.changes || []).forEach(change => {
      addLog('instagram', change.field, change.value);
      console.log(`[instagram] change field=${change.field}`);
    });
  });
}

// ── Marketing API ─────────────────────────────────────────────────────────────
function handleMarketing(body) {
  body.entry.forEach(entry => {
    (entry.changes || []).forEach(change => {
      addLog('marketing', change.field, change.value);
      console.log(`[marketing] change field=${change.field}`);
    });
  });
}

app.listen(PORT, () => {
  console.log(`Meta webhook server running on port ${PORT}`);
  console.log(`Logs: /logs`);
});
