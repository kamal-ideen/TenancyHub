const fs = require('fs');

const htmlPath = fs.existsSync('public/messages.html') ? 'public/messages.html' : 'messages.html';
const cssPath = fs.existsSync('public/style.css') ? 'public/style.css' : 'style.css';

// 1. Remove the exact '(' sitting above Rent Reminder
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  const rentIdx = html.indexOf('Rent Reminder');
  if (rentIdx !== -1) {
    const startIdx = Math.max(0, rentIdx - 300);
    const before = html.substring(startIdx, rentIdx);
    const cleanedBefore = before.replace(/\(/g, '');
    html = html.substring(0, startIdx) + cleanedBefore + html.substring(rentIdx);
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('✓ Removed stray ( above quick replies');
  }
}

// 2. Inject modern layout styles for chat bubbles and composer
if (fs.existsSync(cssPath)) {
  const styles = `
/* --- Modern Messaging UI Finisher --- */
.chat-card {
  display: flex !important;
  flex-direction: column !important;
  height: calc(100vh - 130px) !important;
  background: #ffffff !important;
  border-radius: 12px !important;
}

/* Chat bubble styling */
.chat-messages, #chatWindow, .chat-thread {
  flex: 1 !important;
  overflow-y: auto !important;
  padding: 16px !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 10px !important;
}

.message-bubble, .chat-card [class*="message"] {
  max-width: 65% !important;
  min-width: 70px !important;
  width: fit-content !important;
  padding: 10px 14px !important;
  border-radius: 16px !important;
  font-size: 0.9rem !important;
  line-height: 1.4 !important;
  word-break: break-word !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
}

.message-bubble.outgoing, .chat-card [class*="outgoing"] {
  margin-left: auto !important;
  align-self: flex-end !important;
  background: #0052cc !important;
  color: #ffffff !important;
  border-bottom-right-radius: 4px !important;
}

.message-bubble.incoming, .chat-card [class*="incoming"] {
  margin-right: auto !important;
  align-self: flex-start !important;
  background: #f1f5f9 !important;
  color: #0f172a !important;
  border-bottom-left-radius: 4px !important;
}

/* Modern inline chat composer */
.chat-composer, #chatForm, .chat-card form, .chat-card > div:last-child {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 12px 16px !important;
  border-top: 1px solid #e2e8f0 !important;
  background: #ffffff !important;
  box-sizing: border-box !important;
}

.chat-composer input[type="text"], #chatInput, .chat-card input[type="text"] {
  flex: 1 1 auto !important;
  height: 42px !important;
  border-radius: 22px !important;
  border: 1px solid #cbd5e1 !important;
  padding: 0 16px !important;
  font-size: 0.92rem !important;
  outline: none !important;
  box-sizing: border-box !important;
}

.chat-composer button[type="submit"], #chatSendBtn, .chat-card button:last-child {
  width: auto !important;
  height: 42px !important;
  padding: 0 22px !important;
  border-radius: 22px !important;
  background: #0052cc !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  border: none !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
`;
  fs.appendFileSync(cssPath, styles, 'utf8');
  console.log('✓ Injected modern chat UI styles into style.css');
}

console.log('\nFinished! Refresh your browser tab.');