const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'template/qwint-caption-landing_page');
const destDir = path.join(__dirname, 'src/views');

const files = ['privacy.html', 'refund.html', 'support.html', 'terms.html'];

files.forEach(file => {
    let content = fs.readFileSync(path.join(srcDir, file), 'utf8');
    // replace links
    content = content.replace(/index\.html/g, '/');
    content = content.replace(/privacy\.html/g, '/privacy');
    content = content.replace(/refund\.html/g, '/refund');
    content = content.replace(/support\.html/g, '/support');
    content = content.replace(/terms\.html/g, '/terms');

    const destFile = path.join(destDir, file.replace('.html', '.ejs'));
    fs.writeFileSync(destFile, content);
});

console.log('Done converting static pages.');
