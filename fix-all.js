const fs = require('fs');

// Target files
const filesToCheck = ['public/messages.html', 'messages.html', 'public/app.js', 'app.js'].filter(f => fs.existsSync(f));
const cssFiles = ['public/style.css', 'style.css'].filter(f => fs.existsSync(f));

// 1. Hunt and wipe the rogue '(' across HTML and JS
filesToCheck.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Search specifically near 'Rent Reminder'
  const rentIdx = content.indexOf('Rent Reminder');
  if (rentIdx !== -1) {
    const start = Math.max(0, rentIdx - 500);
    const chunk = content.substring(start, rentIdx);
    if (chunk.includes('(')) {
      const cleanedChunk = chunk.replace(/\(/g, '');
      content = content.substring(0, start) + cleanedChunk + content.substring(rentIdx);
      console.log(`✓ Removed stray '(' near Rent Reminder in ${file}`);
    }
  }

  // Strip standalone '(' sitting between HTML tags
  content = content.replace(/>\s*\(\s*</g, '><');
  content = content.replace(/>\s*\(\s*<div/gi, '><div');
  content = content.replace(/>\s*\(\s*<button/gi, '><button');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`✓ Cleaned stray characters in ${file}`);
  }
});

// 2. Fix the scroll and layout constraints in style.css
cssFiles.forEach(file => {
  const fixes = `
/* ===================================================
   SCROLL UNLOCK & VIEWPORT ADAPTATION
   =================================================== */

/* 1. Force the page to allow vertical scrolling */
html, body {
  overflow-y: auto !important;
  height: auto !important;
  min-height: 100vh !important;
}

/* 2. Prevent layout overflow */
.messages-layout {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  margin-bottom: 40px !important;
  overflow: visible !important;
}

/* 3. Keep the chat card within screen bounds */
.chat-card {
  height: auto !important;
  max-height: 85vh !important;
  display: flex !important;
  flex-direction: column !important;
  padding: 16px !important;
  box-sizing: border-box !important;
}

/* 4. Constrain message list height so the Send button stays visible */
.chat-card > div:first-of-type,
#chatWindow,
.chat-messages,
.chat-thread {
  flex: 1 1 240px !important;
  max-height: 300px !important;
  min-height: 180px !important;
  overflow-y: auto !important;
  padding: 10px !important;
}

/* 5. Clean, readable chat bubble widths */
.chat-card [class*="message"],
#chatWindow > div,
.chat-messages > div {
  max-width: 68% !important;
  width: fit-content !important;
  min-width: 60px !important;
  padding: 8px 14px !important;
  border-radius: 14px !important;
  margin: 6px 0 6px auto !important;
  line-height: 1.4 !important;
  box-sizing: border-box !important;
}

/* 6. Inline Composer */
#chatForm,
.chat-card form {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 8px !important;
  width: 100% !important;
  margin-top: 8px !important;
}

#chatInput {
  flex: 1 1 auto !important;
  height: 40px !important;
  border-radius: 20px !important;
  border: 1px solid #cbd5e1 !important;
  padding: 0 16px !important;
  outline: none !important;
}

#chatSendBtn,
.chat-card button[type="submit"] {
  width: auto !important;
  min-width: 85px !important;
  height: 40px !important;
  border-radius: 20px !important;
  padding: 0 20px !important;
  flex-shrink: 0 !important;
}
`;

  fs.appendFileSync(file, fixes, 'utf8');
  console.log(`✓ Unlocked scrolling and applied layout fixes to ${file}`);
});

console.log('\nFixes complete. Head to Chrome and hit Ctrl + F5.');