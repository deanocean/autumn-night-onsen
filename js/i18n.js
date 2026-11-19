// 介面文字：中文／English／日本語。新增畫面上的文字一律在這裡加 key，三種語言都要填。
// 語言只在開始畫面切換；第一次開啟時跟隨瀏覽器語言（ja → 日本語、zh → 中文、其他 → English），選過後記在 localStorage。
// HTML 裡的靜態文字用 data-i18n（純文字）或 data-i18n-html（含 <br>、<kbd> 的句子）標上 key；
// 程式裡用 t(key)，需要在切換時重畫的（按鈕、區域標籤）用 onLang() 訂閱。
// 不翻的：場景裡的招牌（暖簾「湯」、牛乳瓶）、副標題「貸切 · 眺望の湯 · 十一月」（裝飾文）、開發者面板。

export const LANGS = ['zh', 'en', 'ja'];
const HTML_LANG = { zh: 'zh-Hant', en: 'en', ja: 'ja' };

const STR = {
  zh: {
    title: '秋夜露天風呂',
    lead: '四處走走、與環境互動，沈浸在自然中。<br>泡進湯裡，好好放鬆，把時間交給海灣與天色。<br>建議戴上耳機。',
    start: '進入場景',
    preparing: '準備中…',
    'key.mouse': '滑鼠',
    'key.move': '移動', 'key.look': '轉動視角', 'key.run': '快走', 'key.interact': '與注視的東西互動',
    'key.help': '操作說明', 'key.time': '切換白天／黃昏／夜晚', 'key.views': '觀景點（高處與長焦的鏡頭）',
    'key.top': '鳥瞰全區', 'key.labels': '區域標籤', 'key.sound': '聲音開／關', 'key.esc': '釋放滑鼠',
    'key.dev': '開發者面板（日文鍵盤：Shift + @）',
    'help.title': '操作說明',
    'help.things': '可以互動的東西',
    'help.how': '走到兩三步內、看著它，它會微微發亮，這時按 E。',
    'help.pool': '溫泉池', 'help.pool.where': '站在水深及膝以上的地方', 'help.pool.do': '泡湯，再按 E 起身',
    'help.oke': '檜木桶', 'help.oke.where': '東屋下的池邊，小凳旁', 'help.oke.do': '舀水往身上淋',
    'help.lamp': '燈籠', 'help.lamp.where': '石燈籠、行燈、足元灯、簷下吊燈籠、入口提燈', 'help.lamp.do': '逐盞點燈、熄燈',
    'help.ashiyu': '足湯', 'help.ashiyu.where': '北側望景台的檜木槽', 'help.ashiyu.do': '坐下泡腳賞景，再按 E 起身',
    'help.tsubo': '壺湯', 'help.tsubo.where': '東北角，圓池中央的陶壺', 'help.tsubo.do': '坐進壺裡賞景，再按 E 起身',
    'help.chair': '躺椅', 'help.chair.where': '西北角的小木台', 'help.chair.do': '躺下看星星，再按 E 起身',
    'help.maple': '低垂楓枝', 'help.maple.where': '湯屋往池子的小徑上方', 'help.maple.do': '搖落紅葉',
    'help.milk': '牛奶', 'help.milk.where': '簷廊小台上，共三瓶', 'help.milk.do': '拿起來喝',
    'help.night': '夜裡把燈全部熄掉，星空會慢慢亮起來。鹿威し會自己注水、敲石，不必按鍵。',
    'help.close': '按 H 關閉',
    'ui.sound.on': '聲音：開', 'ui.sound.off': '聲音：關',
    'ui.to.dusk': '切換到黃昏', 'ui.to.night': '切換到夜晚', 'ui.to.day': '切換到白天',
    'ui.help': '操作說明',
    'ui.resume': '點一下畫面繼續（或按住滑鼠拖曳轉動視角）',
    'ui.webgl': '這個瀏覽器無法啟動 WebGL，請改用桌機版 Chrome、Edge 或 Safari。',
    'hint.light': '點燈', 'hint.unlight': '熄燈', 'hint.oke': '舀水', 'hint.ashiyu': '坐下泡腳',
    'hint.stars': '躺下看星星', 'hint.lie': '躺下', 'hint.tsubo': '入壺湯', 'hint.maple': '搖一搖楓枝',
    'hint.milk': '喝一瓶', 'hint.up': '起身', 'hint.soak': '泡湯',
    'view.n': '觀景點', 'view.of': '／', 'view.next': '下一個', 'view.back': '回到原位',
    'view.bathhouse': '湯屋全景', 'view.roofs': '屋頂與海灣', 'view.tower': '望樓', 'view.cliff': '崖外回望', 'view.karahafu': '唐破風',
    'label.engawa': '湯屋簷廊（起點）', 'label.entrance': '入口・唐破風', 'label.path': '石板小徑', 'label.covered': '半露天區',
    'label.pool': '主池', 'label.rock': '池中大岩', 'label.yuguchi': '湯口', 'label.deck': '望景木台・足湯',
    'label.chair': '躺椅', 'label.tsubo': '壺湯', 'label.bay': '海灣・遠山（敞開面）', 'label.shishi': '鹿威し',
    'label.oke': '木桶', 'label.milk': '牛奶',
  },
  en: {
    title: 'Autumn Night Onsen',
    lead: 'Wander around, interact with your surroundings, and lose yourself in nature.<br>Slip into the hot spring, unwind, and leave the hours to the bay and the sky.<br>Headphones recommended.',
    start: 'Step in',
    preparing: 'Preparing…',
    'key.mouse': 'Mouse',
    'key.move': 'Move', 'key.look': 'Look around', 'key.run': 'Walk faster', 'key.interact': "Interact with what you're looking at",
    'key.help': 'Controls', 'key.time': 'Cycle day / dusk / night', 'key.views': 'Viewpoints (high and telephoto shots)',
    'key.top': "Bird's-eye view", 'key.labels': 'Area labels', 'key.sound': 'Sound on / off', 'key.esc': 'Release the mouse',
    'key.dev': 'Developer panel (JIS keyboard: Shift + @)',
    'help.title': 'Controls',
    'help.things': 'Things you can interact with',
    'help.how': 'Walk within two or three steps and look at it. When it glows softly, press E.',
    'help.pool': 'Hot spring pool', 'help.pool.where': 'Stand where the water is at least knee-deep', 'help.pool.do': 'Soak; press E again to get up',
    'help.oke': 'Hinoki bucket', 'help.oke.where': "At the pool's edge under the pavilion, by the stool", 'help.oke.do': 'Scoop water and pour it over yourself',
    'help.lamp': 'Lanterns', 'help.lamp.where': 'Stone lanterns, andon, path lights, hanging eave lanterns, entrance lanterns', 'help.lamp.do': 'Light or put out each one',
    'help.ashiyu': 'Footbath', 'help.ashiyu.where': 'The hinoki trough on the north lookout deck', 'help.ashiyu.do': 'Sit, soak your feet and enjoy the view; press E again to get up',
    'help.tsubo': 'Pot bath', 'help.tsubo.where': 'Northeast corner, the ceramic pot in the round pool', 'help.tsubo.do': 'Sit in the pot and take in the view; press E again to get out',
    'help.chair': 'Lounge chair', 'help.chair.where': 'The small wooden deck in the northwest corner', 'help.chair.do': 'Lie back and watch the stars; press E again to get up',
    'help.maple': 'Low maple branch', 'help.maple.where': 'Above the path from the bathhouse to the pool', 'help.maple.do': 'Shake down red leaves',
    'help.milk': 'Milk', 'help.milk.where': 'Three bottles on the small stand on the veranda', 'help.milk.do': 'Pick one up and drink',
    'help.night': 'Put out every lantern at night and the stars slowly grow brighter. The shishi-odoshi fills and knocks on its own, with no key needed.',
    'help.close': 'Press H to close',
    'ui.sound.on': 'Sound: On', 'ui.sound.off': 'Sound: Off',
    'ui.to.dusk': 'Switch to dusk', 'ui.to.night': 'Switch to night', 'ui.to.day': 'Switch to day',
    'ui.help': 'Controls',
    'ui.resume': 'Click to continue (or drag to look around)',
    'ui.webgl': "WebGL couldn't start in this browser. Please use desktop Chrome, Edge or Safari.",
    'hint.light': 'Light', 'hint.unlight': 'Put out', 'hint.oke': 'Pour water', 'hint.ashiyu': 'Soak your feet',
    'hint.stars': 'Lie back and stargaze', 'hint.lie': 'Lie down', 'hint.tsubo': 'Get into the pot bath', 'hint.maple': 'Shake the branch',
    'hint.milk': 'Drink a bottle', 'hint.up': 'Get up', 'hint.soak': 'Soak',
    'view.n': 'Viewpoint', 'view.of': ' / ', 'view.next': 'Next', 'view.back': 'Go back',
    'view.bathhouse': 'The bathhouse', 'view.roofs': 'Rooftops and the bay', 'view.tower': 'The lookout tower', 'view.cliff': 'Looking back from beyond the cliff', 'view.karahafu': 'The karahafu gable',
    'label.engawa': 'Veranda (start)', 'label.entrance': 'Entrance · Karahafu', 'label.path': 'Stone path', 'label.covered': 'Covered bath area',
    'label.pool': 'Main pool', 'label.rock': 'Center rock', 'label.yuguchi': 'Spout', 'label.deck': 'Lookout deck · Footbath',
    'label.chair': 'Lounge chair', 'label.tsubo': 'Pot bath', 'label.bay': 'Bay · Distant hills (open side)', 'label.shishi': 'Shishi-odoshi',
    'label.oke': 'Bucket', 'label.milk': 'Milk',
  },
  ja: {
    title: '秋夜の露天風呂',
    lead: 'あたりを歩き、ふれて、自然にひたる。<br>湯につかってのんびりと、時間は海と空にまかせて。<br>ヘッドホンでどうぞ。',
    start: '湯へ',
    preparing: '準備中…',
    'key.mouse': 'マウス',
    'key.move': '移動', 'key.look': '視点を動かす', 'key.run': '早歩き', 'key.interact': '見ているものを使う',
    'key.help': '操作説明', 'key.time': '昼・夕暮れ・夜を切り替え', 'key.views': '展望ポイント（高所や望遠のカメラ）',
    'key.top': '全体を俯瞰', 'key.labels': 'エリア名', 'key.sound': 'サウンド オン／オフ', 'key.esc': 'マウスを解放',
    'key.dev': '開発者パネル（JIS キーボード：Shift + @）',
    'help.title': '操作説明',
    'help.things': 'さわれるもの',
    'help.how': '二、三歩まで近づいて見つめると、ほのかに光ります。そこで E を押してください。',
    'help.pool': '湯船', 'help.pool.where': '膝より深いところに立つ', 'help.pool.do': '湯につかる。もう一度 E で上がる',
    'help.oke': '檜の手桶', 'help.oke.where': '東屋の下の湯船のふち、腰掛けの横', 'help.oke.do': 'かけ湯をする',
    'help.lamp': '灯り', 'help.lamp.where': '石灯籠、行灯、足元灯、軒の吊り灯籠、入口の提灯', 'help.lamp.do': '一つずつ灯す・消す',
    'help.ashiyu': '足湯', 'help.ashiyu.where': '北の展望デッキにある檜の湯槽', 'help.ashiyu.do': '腰掛けて足湯から景色を。もう一度 E で立つ',
    'help.tsubo': '壺湯', 'help.tsubo.where': '北東の角、丸い池の中央の陶の壺', 'help.tsubo.do': '壺に入って景色を。もう一度 E で出る',
    'help.chair': '寝椅子', 'help.chair.where': '北西の角の小さな木の台', 'help.chair.do': '寝ころんで星を眺める。もう一度 E で起きる',
    'help.maple': '垂れた楓の枝', 'help.maple.where': '湯屋から湯船への小道の上', 'help.maple.do': '揺すって紅葉を散らす',
    'help.milk': '牛乳', 'help.milk.where': '縁側の小さな台に三本', 'help.milk.do': '手に取って飲む',
    'help.night': '夜に灯りをすべて消すと、星空がゆっくり明るくなります。鹿威しはひとりでに水を受けて石を打ちます。',
    'help.close': 'H で閉じる',
    'ui.sound.on': 'サウンド：オン', 'ui.sound.off': 'サウンド：オフ',
    'ui.to.dusk': '夕暮れへ', 'ui.to.night': '夜へ', 'ui.to.day': '昼へ',
    'ui.help': '操作説明',
    'ui.resume': 'クリックで再開（ドラッグでも視点を動かせます）',
    'ui.webgl': 'このブラウザでは WebGL を起動できません。デスクトップ版の Chrome、Edge、Safari をお使いください。',
    'hint.light': '灯す', 'hint.unlight': '消す', 'hint.oke': 'かけ湯', 'hint.ashiyu': '足湯に入る',
    'hint.stars': '寝ころんで星を見る', 'hint.lie': '寝ころぶ', 'hint.tsubo': '壺湯に入る', 'hint.maple': '枝を揺らす',
    'hint.milk': '一本飲む', 'hint.up': '立ち上がる', 'hint.soak': '湯につかる',
    'view.n': '展望ポイント', 'view.of': '／', 'view.next': '次へ', 'view.back': 'もどる',
    'view.bathhouse': '湯屋の全景', 'view.roofs': '屋根と海', 'view.tower': '望楼', 'view.cliff': '崖の外から', 'view.karahafu': '唐破風',
    'label.engawa': '縁側（スタート）', 'label.entrance': '入口・唐破風', 'label.path': '石畳の小道', 'label.covered': '半露天',
    'label.pool': '岩風呂', 'label.rock': '湯船の大岩', 'label.yuguchi': '湯口', 'label.deck': '展望デッキ・足湯',
    'label.chair': '寝椅子', 'label.tsubo': '壺湯', 'label.bay': '海と遠くの山（開けた側）', 'label.shishi': '鹿威し',
    'label.oke': '手桶', 'label.milk': '牛乳',
  },
};

function detect() {
  try { const s = localStorage.getItem('onsen-lang'); if (STR[s]) return s; } catch (_) { /* 讀不到就看瀏覽器 */ }
  for (const l of navigator.languages || [navigator.language || '']) {
    const k = l.toLowerCase();
    if (k.startsWith('ja')) return 'ja';
    if (k.startsWith('zh')) return 'zh';
    if (k.startsWith('en')) return 'en';
  }
  return 'en';
}

export let lang = detect();
const subs = [];

export function t(key) {
  const s = STR[lang][key] ?? STR.zh[key];
  if (s === undefined) console.warn(`i18n：沒有 ${key}`);
  return s ?? key;
}

export function onLang(fn) { subs.push(fn); }

function applyDom() {
  const root = document.documentElement;
  root.lang = HTML_LANG[lang];
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false'));
  root.classList.add('i18n');
}

export function setLang(l) {
  if (!STR[l]) return;
  lang = l;
  try { localStorage.setItem('onsen-lang', l); } catch (_) { /* 不記也無妨 */ }
  applyDom();
  subs.forEach((fn) => fn(l));
}

// 開始畫面的語言按鈕
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang); b.blur(); }));
applyDom();
