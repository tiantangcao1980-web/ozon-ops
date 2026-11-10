import fs from 'node:fs';
const P = 'assets/listing-batch-1.csv';
let txt = fs.readFileSync(P, 'utf8');
const lines = txt.split(/\r?\n/);
const newTitles = {
  W2: 'Щетка для снега автомобильная с мягкой щетиной, не царапает кузов, со скребком для льда и телескопической ручкой, 2 в 1, зимняя',
  P1: 'Когтеточка для кошек из плотного 5-слойного гофрокартона, не оставляет крошек, настенная с креплением в комплекте, точные размеры 400×300 мм, серая'
};
for (let i = 0; i < lines.length; i++) {
  for (const k of Object.keys(newTitles)) {
    if (lines[i].startsWith(k + ',')) {
      const cells = []; let cur = ''; let q = false;
      for (let j = 0; j < lines[i].length; j++) {
        const c = lines[i][j];
        if (c === '"') { if (q && lines[i][j+1] === '"') { cur += '"'; j++; } else q = !q; }
        else if (c === ',' && !q) { cells.push(cur); cur = ''; } else cur += c;
      }
      cells.push(cur);
      cells[2] = newTitles[k];
      lines[i] = cells.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',');
    }
  }
}
fs.writeFileSync(P, lines.join('\r\n'), 'utf8');
for (const l of lines) if (/^(W2|P1),/.test(l)) console.log(l.slice(0, 150));