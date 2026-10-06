// Apps Script の画面に貼り付けやすいように、1つのプロジェクト分の .gs を1ファイルにまとめる。
// 実行：node gas/build.js  →  gas/dist/ に プロジェクト名.gs と プロジェクト名_appsscript.json ができる

const fs = require('fs');
const path = require('path');

const PROJECTS = {
  '取り込み': { files: ['共通.gs', '取り込み/取り込み.gs', '取り込み/実行.gs'], manifest: '取り込み/appsscript.json' },
  'API': { files: ['共通.gs', 'api/API.gs'], manifest: 'api/appsscript.json' },
};

const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });

for (const [name, { files, manifest }] of Object.entries(PROJECTS)) {
  const parts = files.map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(__dirname, f), 'utf8').trimEnd());
  const head = `// 自動で作ったファイル（node gas/build.js）。直すときは gas/ の元のファイルを直す。\n`;
  fs.writeFileSync(path.join(dist, `${name}.gs`), head + '\n' + parts.join('\n\n') + '\n');
  fs.copyFileSync(path.join(__dirname, manifest), path.join(dist, `${name}_appsscript.json`));
  console.log(`dist/${name}.gs`);
}
