const fs = require('fs');

// Locate HTML & CSS files
const htmlPath = fs.existsSync('public/messages.html') ? 'public/messages.html' : 'messages.html';
const cssPath = fs.existsSync('public/style.css') ? 'public/style.css' : 'style.css';

console.log(`Fixing ${htmlPath}...`);
let html = fs.readFileSync(htmlPath, 'utf8');

// 1. Remove standalone or orphaned '(' above quick replies
html = html.replace(/^\s*\(\s*$/gm, '');
html = html.replace(/>\s*\(\s*</g, '><');
html = html.replace(/\(\s*(<button[^>]*>Rent Reminder)/gi, '$1');
html = html.replace(/\(\s*(<div[^>]*>\s*<button[^>]*>Rent Reminder)/gi, '$1');

// 2. Remove stray '<' near page headers/containers
html = html.replace(/^\s*<\s*$/gm, '');
html = html.replace(/>\s*<\s*<div/gi, '><div');
html = html.replace(/>\s*<\s*<section/gi, '><section');
html = html.replace(/>\s*<\s*<main/gi, '><main');
html = html.replace(/<body>\s*</gi, '<body>');

fs.writeFileSync(htmlPath, html, 'utf8');
console.log(`✓ Cleaned stray characters in ${htmlPath}`);

// 3. Remove horizontal scrollbars in CSS
if (fs.existsSync(cssPath)) {
  const cssFix = `
/* --- Auto-fix: Remove horizontal scrollbars --- */
.conversation-panel {
  overflow-x: hidden !important;
}
.quick-reply-bar, .quick-replies {
  overflow-x: auto !important;
  scrollbar-width: none !important;
}
.quick-reply-bar::-webkit-scrollbar, .quick-replies::-webkit-scrollbar {
  display: none !important;
}
`;
  fs.appendFileSync(cssPath, cssFix, 'utf8');
  console.log(`✓ Applied CSS scrollbar fixes to ${cssPath}`);
}

console.log('\nSuccess! Now refresh your browser.');