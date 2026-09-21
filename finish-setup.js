const fs = require('fs');

const cssPath = fs.existsSync('public/style.css') ? 'public/style.css' : (fs.existsSync('style.css') ? 'style.css' : null);

if (!cssPath) {
  console.error('Could not find style.css');
  process.exit(1);
}

const styles = `
/* =========================================================
   TENANCYHUB MESSAGING LAYOUT REFINEMENTS
   ========================================================= */

/* 1. Page spacing: prevent topbar overlap */
main, main.container, .main-content {
  padding-top: 24px !important;
  box-sizing: border-box !important;
}

/* 2. Grid & Sidebar height bounds */
.messages-layout {
  display: grid !important;
  grid-template-columns: 320px 1fr !important;
  gap: 20px !important;
  height: calc(100vh - 110px) !important;
  align-items: stretch !important;
  box-sizing: border-box !important;
}

.conversation-panel {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
  box-sizing: border-box !important;
}

/* 3. Card Proportions & Message Stream */
.chat-card {
  display: flex !important;
  flex-direction: column !important;
  height: 100% !important;
  max-height: 100% !important;
  background: #ffffff !important;
  border: 1px solid #e2e8f0 !important;
  border-radius: 12px !important;
  padding: 16px !important;
  box-sizing: border-box !important;
  overflow: hidden !important;
}

.chat-card > div:first-of-type,
#chatWindow,
.chat-messages,
.chat-thread {
  flex: 1 1 auto !important;
  overflow-y: auto !important;
  min-height: 0 !important;
  padding: 12px 4px !important;
  box-sizing: border-box !important;
}

/* 4. Action icons row */
.chat-actions,
.chat-card .composer-tools,
.chat-card div:has(> button[title]) {
  display: flex !important;
  flex-direction: row !important;
  gap: 8px !important;
  margin: 6px 0 !important;
}

/* 5. Modern Inline Composer: Input + Send button on a single line */
.chat-card form,
#chatForm,
.chat-composer,
.chat-card > div:last-child {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  margin-top: auto !important;
  padding-top: 10px !important;
  border-top: 1px solid #f1f5f9 !important;
  background: transparent !important;
  box-sizing: border-box !important;
}

/* Constrain input field to single line */
.chat-card input[type="text"],
.chat-card textarea,
#chatInput {
  flex: 1 1 auto !important;
  height: 42px !important;
  min-height: 42px !important;
  max-height: 42px !important;
  border-radius: 22px !important;
  border: 1px solid #cbd5e1 !important;
  padding: 0 16px !important;
  font-size: 0.92rem !important;
  outline: none !important;
  resize: none !important;
  line-height: 40px !important;
  background: #f8fafc !important;
  box-sizing: border-box !important;
  margin: 0 !important;
}

.chat-card input[type="text"]:focus,
#chatInput:focus {
  border-color: #2563eb !important;
  background: #ffffff !important;
}

/* Pill-shaped Send Button */
.chat-card button[type="submit"],
#chatSendBtn,
.chat-card .btn-primary:last-child {
  width: auto !important;
  min-width: 90px !important;
  height: 42px !important;
  max-height: 42px !important;
  padding: 0 22px !important;
  border-radius: 22px !important;
  background: #0052cc !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  font-size: 0.9rem !important;
  border: none !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex-shrink: 0 !important;
  margin: 0 !important;
}
`;

fs.appendFileSync(cssPath, styles, 'utf8');
console.log('✓ Applied messaging layout rules to ' + cssPath);