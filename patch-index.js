const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, 'template/qwint-caption-landing_page/index.html');
const destFile = path.join(__dirname, 'src/views/index.ejs');
const oldIndexFile = path.join(__dirname, 'src/views/index.ejs');

let newHtml = fs.readFileSync(srcFile, 'utf8');

// The original index.ejs is still there! So we can read it to copy the modal stuff.
const oldHtml = fs.readFileSync(oldIndexFile, 'utf8');

// 1. Extract Modal CSS
const cssMatch = oldHtml.match(/\/\* ── Toast ── \*\/(.|\n)*?\/\* ── Login Modal ── \*\/(.|\n)*?<\/style>/);
let modalCSS = '';
if (cssMatch) {
    // Actually just extract everything from /* ── Toast ── */ to the end of <style>
    modalCSS = oldHtml.substring(oldHtml.indexOf('/* ── Toast ── */'), oldHtml.indexOf('</style>'));
}

// 2. Extract Toast & Modal HTML
const htmlMatch = oldHtml.substring(oldHtml.indexOf('<div class="toast"'), oldHtml.indexOf('<script>'));

// 3. Extract Script
const scriptMatch = oldHtml.substring(oldHtml.indexOf('<script>'), oldHtml.indexOf('</body>'));

// Add modal CSS
newHtml = newHtml.replace('</head>', `    <style>\n${modalCSS}\n    </style>\n  </head>`);

// Add Toast & Modal HTML & Script right before </body>
// Before that, make sure to replace internal links to root: index.html -> /
newHtml = newHtml.replace(/index\.html/g, '/');
newHtml = newHtml.replace(/privacy\.html/g, '/privacy');
newHtml = newHtml.replace(/refund\.html/g, '/refund');
newHtml = newHtml.replace(/support\.html/g, '/support');
newHtml = newHtml.replace(/terms\.html/g, '/terms');

// The header link: "Get Qwint Caption ->" -> Login
// Original template nav-cta:
/*
        <div class="nav-cta">
          <a href="#pricing" class="btn btn-outline" id="nav-pricing-btn">View Pricing</a>
          <a href="#stripe-checkout" class="btn btn-primary" id="nav-download-btn">Get Qwint Caption →</a>
        </div>
*/
newHtml = newHtml.replace(
    '<a href="#stripe-checkout" class="btn btn-primary" id="nav-download-btn">Get Qwint Caption →</a>',
    '<a href="#" onclick="openLogin(event)" class="btn btn-primary" id="nav-login-btn">🔑 Login</a>'
);
// Also for mobile nav:
newHtml = newHtml.replace(
    '<a href="#stripe-checkout" class="btn btn-primary btn-lg">Get Qwint Caption →</a>',
    '<a href="#" onclick="openLogin(event)" class="btn btn-primary btn-lg">🔑 Login</a>'
);
// Make sure openLogin doesn't follow href
const scriptMatchFixed = scriptMatch.replace(/function openLogin\(\) \{/, 'function openLogin(e) { if(e) e.preventDefault();');

newHtml = newHtml.replace('</body>', `\n${htmlMatch}\n${scriptMatchFixed}\n</body>`);

fs.writeFileSync(destFile, newHtml);
console.log('index.ejs successfully generated.');
