const fs = require('fs');

const htmlFiles = ['public/messages.html', 'messages.html'].filter(f => fs.existsSync(f));
const cssFiles = ['public/style.css', 'style.css'].filter(f => fs.existsSync(f));

htmlFiles.forEach(file => {
  let html = fs.readFileSync(file, 'utf8');

  // 1. Wipe the rogue '(' completely
  const rentIdx = html.indexOf('Rent Reminder');
  if (rentIdx !== -1) {
    const start = Math.max(0, rentIdx - 2000);
    const before = html.substring(start, rentIdx);
    const cleaned = before
      .replace(/>\s*\(\s*</g, '><')
      .replace(/\(\s*<div/gi, '<div')
      .replace(/\(\s*<button/gi, '<button')
      .replace(/^\s*\(\s*$/gm, '');
    html = html.substring(0, start) + cleaned + html.substring(rentIdx);
  }
  html = html.replace(/^\s*\(\s*$/gm, '');
  html = html.replace(/>\s*\(\s*</g, '><');

  // 2. Wrap input and Send button into an inline <form id="chatForm">
  if (!html.includes('id="chatForm"')) {
    const inputMatch = html.match(/(<input[^>]*id="chatInput"[^>]*>)/i) || html.match(/(<input[^>]*placeholder="Type a message\.\.\."[^>]*>)/i);
    const sendMatch = html.match(/(<button[^>]*>[^<]*Send[^<]*<\/button>)/i);

    if (inputMatch && sendMatch) {
      const oldInput = inputMatch[1];
      const oldSend = sendMatch[1];

      // Extract existing attributes or build clean inline elements
      const cleanInput = '<input type="text" id="chatInput" placeholder="Type a message..." style="flex:1 1 auto; height:42px; border-radius:21px; padding:0 18px; border:1px solid #cbd5e1; outline:none; box-sizing:border-box; font-size:0.92rem;">';
      const cleanSend = '<button type="submit" id="chatSendBtn" style="width:auto; min-width:96px; height:42px; border-radius:21px; background:#0052cc; color:#ffffff; font-weight:600; border:none; padding:0 22px; cursor:pointer; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;">Send</button>';

      const formHtml = `\n<form id="chatForm" style="display:flex !important; flex-direction:row !important; align-items:center !important; gap:10px !important; width:100% !important; margin-top:8px !important; box-sizing:border-box !important;">\n  ${cleanInput}\n  ${cleanSend}\n</form>\n`;

      // Replace input with the full form, and remove the stranded send button
      html = html.replace(oldInput, formHtml);
      html = html.replace(oldSend, '');
      console.log(`✓ Converted input and Send button into inline #chatForm in ${file}`);
    }
  }

  fs.writeFileSync(file, html, 'utf8');
  console.log(`✓ Cleaned stray characters in ${file}`);
});

cssFiles.forEach(file => {
  const css = `
/* Forced inline layout for composer */
#chatForm {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  margin-top: 8px !important;
}
#chatInput {
  flex: 1 1 auto !important;
  height: 42px !important;
}
#chatSendBtn {
  width: auto !important;
  height: 42px !important;
  flex-shrink: 0 !important;
}
`;
  fs.appendFileSync(file, css, 'utf8');
  console.log(`✓ Added inline rules to ${file}`);
});

console.log('\nDone! Refresh browser with Ctrl + F5.');