// 플러그인 아이콘과 키 미리보기를 draw.js로 그린다. 실제 키와 같은 코드로 그리므로 아이콘이 키 화면과 어긋나지 않는다.
//   npx electron integrations/ulanzi/render-icons.cjs [미리보기 저장 경로]
// assets/action-*.png · plugin.png(196) · category.png(56)를 쓰고, 경로를 주면 키 여러 개를 늘어놓은 미리보기 한 장을 더 쓴다.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const PLUGIN = path.join(__dirname, 'com.ulanzi.whendesk.ulanziPlugin')
const ASSETS = path.join(PLUGIN, 'assets')
const preview = process.argv.find((arg, i) => i >= 2 && arg.endsWith('.png'))

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = key(now)
const shift = (days) => key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
const inMin = (min) => new Date(now.getTime() + min * 60000).toISOString()
const sample = {
  ok: true,
  today,
  counts: { todo: 7, inbox: 3, waiting: 2, overdue: 1, dueToday: 2, staleWaiting: 1, postponed: 1, doneToday: 4 },
  todos: [
    { id: 'a', title: '분기 보고서 초안 쓰기', project: '운영', due: shift(-1), postponed: 3 },
    { id: 'b', title: '덱 플러그인 실기기 확인', project: 'whendesk', due: today, postponed: 0 },
    { id: 'c', title: 'Release notes', project: 'whenpc', due: shift(3), postponed: 0 },
  ],
  next: { id: 1, title: '주간 회의', startsAt: inMin(8), endsAt: inMin(68), date: today, location: '3층 회의실' },
  events: { total: 3, remaining: 2, allDay: [] },
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 400, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<meta charset="utf-8"><body></body>')
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(PLUGIN, 'plugin', 'draw.js'), 'utf8') + ';window.Draw=Draw;0')
  const call = (expr) => win.webContents.executeJavaScript(`(() => { const s = ${JSON.stringify(sample)}; const now = ${now.getTime()}; return ${expr} })()`)
  const icons = {
    today: 'Draw.today(s)',
    task: "Draw.task(s.todos[1], s.today, null, 1)",
    next: 'Draw.next(s.next, s.events, now)',
    count: "Draw.count('inbox', 3)",
    capture: "Draw.capture('clipboard', '', null)",
    open: "Draw.open('dashboard')",
  }
  const save = (file, dataUrl, size) => {
    let image = nativeImage.createFromDataURL(dataUrl)
    if (size) image = image.resize({ width: size, height: size, quality: 'best' })
    fs.writeFileSync(file, image.toPNG())
  }
  fs.mkdirSync(ASSETS, { recursive: true })
  for (const [name, expr] of Object.entries(icons)) save(path.join(ASSETS, `action-${name}.png`), await call(expr))
  const brand = path.resolve(__dirname, '..', '..', '..', 'ulanzi-icons', 'png', '16_whendesk.png')
  const source = fs.existsSync(brand) ? nativeImage.createFromPath(brand) : nativeImage.createFromDataURL(await call('Draw.today(s)'))
  fs.writeFileSync(path.join(ASSETS, 'plugin.png'), source.resize({ width: 196, height: 196, quality: 'best' }).toPNG())
  fs.writeFileSync(path.join(ASSETS, 'category.png'), source.resize({ width: 56, height: 56, quality: 'best' }).toPNG())

  if (preview) {
    // 5×3 (D200 배열) 미리보기: 키마다 다른 상태를 늘어놓는다
    const cells = [
      'Draw.today(s)', "Draw.task(s.todos[0], s.today, null, 1)", "Draw.task(s.todos[1], s.today, null, 2)", "Draw.task(s.todos[2], s.today, 'done', 3)", 'Draw.overflow(4, 4)',
      'Draw.next(s.next, s.events, now)', "Draw.next(Object.assign({}, s.next, { startsAt: new Date(now + 3 * 3600e3).toISOString() }), s.events, now)", 'Draw.next(null, { allDay: ["창립기념일"] }, now)', "Draw.count('overdue', 1)", "Draw.count('inbox', 0)",
      "Draw.capture('clipboard', '', null)", "Draw.capture('phrase', '. 주간보고 작성', null)", "Draw.capture('clipboard', '', { ok: true, message: '인박스에 담았어요' })", "Draw.open('command')", 'Draw.offline()',
    ]
    const urls = []
    for (const expr of cells) urls.push(await call(expr))
    const sheet = await win.webContents.executeJavaScript(`(async () => {
      const urls = ${JSON.stringify(urls)}
      const c = document.createElement('canvas'), gap = 14, s = 196
      c.width = 5 * s + 6 * gap; c.height = 3 * s + 4 * gap
      const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height)
      for (let i = 0; i < urls.length; i++) {
        const img = new Image(); img.src = urls[i]; await img.decode()
        const x = gap + (i % 5) * (s + gap), y = gap + Math.floor(i / 5) * (s + gap)
        g.save(); g.beginPath(); g.roundRect(x, y, s, s, 22); g.clip(); g.drawImage(img, x, y); g.restore()
      }
      return c.toDataURL('image/png')
    })()`)
    save(preview, sheet)
  }
  app.quit()
})
